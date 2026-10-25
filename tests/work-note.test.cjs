'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { Chat } = require('../src/chat.cjs'), { CodexProcess } = require('../src/codex-process.cjs');
const { validNote } = require('../src/work-note.cjs'), { validateSession } = require('../src/session.cjs'), { handoffDraft } = require('../src/context-recovery.cjs');
const fields = { goal: '目的を確認する', completed: '完了を確認した操作', pending: '次に進める作業', uncertain: '保存結果は未確認。繰り返さず確認する' };
async function until(check) { const end = Date.now() + 8000; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('Timed out'); }
function fixture(t) {
  const base = path.resolve(__dirname, '../.artifacts/work-note-tests'); fs.mkdirSync(base, { recursive: true });
  const file = path.join(fs.mkdtempSync(path.join(base, 'case-')), 'state.json'), values = new Map(), calls = [];
  const storage = { get: async key => values.get(key), set: async (key, value) => values.set(key, structuredClone(value)) };
  const make = () => {
    const chat = new Chat({ storage, getHostInfo: async () => ({ instanceId: 'note-fixture' }), clientFactory: () => {
      const client = new CodexProcess({ command: { file: process.execPath, args: [path.join(__dirname, 'fixtures/server.cjs')] }, env: { ...process.env, CHATCODEX_FIXTURE_STATE: file } });
      const request = client.request.bind(client); client.request = (method, params, ...rest) => { calls.push({ method, params: structuredClone(params) }); return request(method, params, ...rest); }; return client;
    }}); t.after(() => chat.close()); return chat;
  };
  return { make, values, calls, storage };
}
async function connect(chat) { chat.connect(chat.generation); await until(() => ['idle', 'error'].includes(chat.state)); assert.equal(chat.state, 'idle', chat.detail); }
async function send(chat, text) { chat.send(chat.generation, 'send-' + Date.now(), text); await until(() => chat.state === 'idle'); }
const save = (chat, text = fields, requestId = 'note-save') => chat.saveNote(chat.generation, chat.threadId, chat.session.workNote?.id || '', requestId, JSON.stringify(text));
test('実stdio: メモは明示保存だけで記録し、再起動後も復元する。Codexへ送らず会話本文を複製しない', async t => {
  const c = fixture(t), first = c.make(); await connect(first);
  await assert.rejects(first.saveNote(first.generation, '', '', 'early', JSON.stringify(fields)));
  await send(first, '作業開始の本文'); const before = c.calls.length; await save(first);
  assert.equal(c.calls.length, before); assert.equal(c.values.get('lastSession').workNote.goal, fields.goal);
  const escaped = Object.fromEntries(Object.keys(fields).map(key => [key, '\u0000'.repeat(800)]));
  await save(first, escaped, 'escaped'); assert.equal(first.session.workNote.goal, escaped.goal); await save(first, fields, 'human');
  assert.equal(c.calls.length, before);
  assert.equal(JSON.stringify(c.values.get('lastSession')).includes('作業開始の本文'), false);
  const note = structuredClone(first.session.workNote), old = structuredClone(first.session); delete old.workNote;
  assert.ok(validateSession(old)); assert.ok(validateSession(first.session)); await first.close(); c.calls.length = 0;
  const next = c.make(); await connect(next); assert.deepEqual(next.read(0, 0).workNote, note);
  assert.equal(c.calls.some(call => ['turn/start', 'thread/start'].includes(call.method)), false);
  await send(next, '通常の続きを送信'); assert.deepEqual(next.session.workNote, note);
});
test('実stdio: 保存の競合と失敗では以前のメモを保持し、古い画面や大きすぎる値を受け付けない', async t => {
  const c = fixture(t), chat = c.make(); await connect(chat); await send(chat, '確認する'); await save(chat);
  const before = structuredClone(chat.session); c.storage.set = async () => { throw Error('fixture disk failure'); };
  await assert.rejects(save(chat, { ...fields, pending: '変更案' }, 'failed'), /保存領域/);
  assert.deepEqual(chat.session, before); assert.deepEqual(c.values.get('lastSession'), before); assert.equal(chat.saving, false);
  await assert.rejects(chat.saveNote(chat.generation - 1, chat.threadId, before.workNote.id, 'old', JSON.stringify(fields)));
  await assert.rejects(chat.saveNote(chat.generation, 'other-thread', before.workNote.id, 'other', JSON.stringify(fields)));
  await assert.rejects(chat.saveNote(chat.generation, chat.threadId, 'old-note', 'stale', JSON.stringify(fields)));
  await assert.rejects(save(chat, { ...fields, goal: 'あ'.repeat(683) }, 'big'));
  await assert.rejects(save(chat, { ...fields, extra: 'no' }, 'extra'));
  await assert.rejects(chat.handoffNote(chat.generation, chat.threadId, 'old-note'));
  let release; c.storage.set = (key, value) => new Promise(resolve => { release = () => { c.values.set(key, value); resolve(); }; });
  const task = save(chat, fields, 'pending'); await until(() => release); assert.equal(chat.saving, true);
  assert.throws(() => chat.send(chat.generation, 'blocked', '保存中')); await assert.rejects(chat.newChat(chat.generation)); await assert.rejects(save(chat, fields, 'racing'));
  release(); await task; const saved = structuredClone(chat.session);
  await chat.saveNote(chat.generation, chat.threadId, before.workNote.id, 'pending', JSON.stringify(fields)); assert.deepEqual(chat.session, saved);
  await assert.rejects(chat.saveNote(chat.generation, chat.threadId, before.workNote.id, 'pending', JSON.stringify({ ...fields, goal: '別の内容' })));
});
test('実stdio: メモによる引き継ぎは下書きだけを作り、明示送信まで元の再開先を保持する', async t => {
  const c = fixture(t), chat = c.make(); await connect(chat); await send(chat, '元の作業'); await save(chat);
  const previous = structuredClone(c.values.get('lastSession')), count = c.calls.length, generation = chat.generation;
  const { draft } = await chat.handoffNote(generation, chat.threadId, chat.session.workNote.id);
  assert.ok(chat.generation > generation); assert.equal(chat.threadId, null); assert.equal(c.calls.length, count);
  assert.deepEqual(c.values.get('lastSession'), previous); assert.ok(draft.includes(fields.uncertain)); assert.match(draft, /結果不明の変更は繰り返さず/);
  assert.equal(chat.nextCwd, previous.cwd); assert.deepEqual(chat.nextWorkNote, previous.workNote); await chat.close();
  const restored = c.make(); await connect(restored); assert.equal(restored.threadId, previous.threadId);
  const next = await restored.handoffNote(restored.generation, restored.threadId, restored.session.workNote.id); c.calls.length = 0;
  await send(restored, next.draft); assert.notEqual(restored.threadId, previous.threadId); assert.equal(restored.session.cwd, previous.cwd);
  assert.deepEqual(restored.session.workNote, previous.workNote); assert.equal(c.values.get('lastSession').threadId, restored.threadId);
  assert.equal(c.calls.filter(call => call.method === 'turn/start').length, 1);
  assert.ok(c.calls.find(call => call.method === 'turn/start').params.input[0].text.includes(fields.pending));
  await restored.newChat(restored.generation); assert.equal(c.values.get('lastSession'), null); assert.equal(restored.read(0, 0).workNote, null);
});
test('実stdio: コンテキスト上限からの引き継ぎにも保存済みメモを含め、空欄でメモ内容を消せる', async t => {
  const c = fixture(t), chat = c.make(); await connect(chat); await send(chat, 'コンテキスト制限'); await save(chat);
  const previous = structuredClone(c.values.get('lastSession')); const { draft } = await chat.handoff(chat.generation, chat.contextRecovery.id);
  assert.ok(draft.includes(fields.goal)); assert.deepEqual(c.values.get('lastSession'), previous);
  await send(chat, '別の作業を開始'); await save(chat, { goal: '', completed: '', pending: '', uncertain: '' }, 'clear');
  await assert.rejects(chat.handoffNote(chat.generation, chat.threadId, chat.session.workNote.id));
  assert.equal(chat.session.workNote.goal, '');
});
test('保存メモと下書きの上限はUTF-8で守り、診断・隠れた内容を引き継がない', () => {
  const note = { id: 'bounded', updatedAt: Date.now(), ...Object.fromEntries(Object.keys(fields).map(key => [key, '😀'.repeat(512)])) };
  assert.equal(validNote(note), true); assert.equal(validNote({ ...note, pending: note.pending + 'x' }), false);
  assert.equal(validNote({ ...note, updatedAt: NaN }), false);
  assert.equal(validNote({ ...note, updatedAt: Number.MAX_SAFE_INTEGER }), false);
  const entries = Array.from({ length: 8 }, (_, index) => ({ messageId: String(index), role: index % 2 ? 'assistant' : 'user', text: 'あ'.repeat(20000) }));
  entries.push({ messageId: 'trace', kind: 'trace', role: 'user', text: 'HIDDEN_TRACE' });
  const draft = handoffDraft(entries, 'X'.repeat(8192), note);
  assert.ok(Buffer.byteLength(draft) <= 32768); assert.ok(!draft.includes('HIDDEN_TRACE')); assert.ok(!draft.includes('\uFFFD'));
  assert.ok(draft.includes(note.goal)); assert.ok(Buffer.byteLength(handoffDraft(entries, 'X'.repeat(8192))) <= 32768);
});
