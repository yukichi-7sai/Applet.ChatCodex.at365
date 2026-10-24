'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { Chat } = require('../src/chat.cjs');
const { CodexProcess } = require('../src/codex-process.cjs');
const { readHistory } = require('../src/session.cjs');
async function until(check) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw Error('Timed out');
}
function fixture(t) {
  const base = path.resolve(__dirname, '../.artifacts/session-tests'); fs.mkdirSync(base, { recursive: true });
  const folder = fs.mkdtempSync(path.join(base, 'case-')), file = path.join(folder, 'fixture.json');
  const values = new Map(), calls = [];
  const storage = { get: async key => values.get(key), set: async (key, value) => values.set(key, structuredClone(value)) };
  const make = (extra = {}) => {
    const chat = new Chat({ storage, getHostInfo: async () => ({ instanceId: 'current-host' }), clientFactory: () => {
      const client = new CodexProcess({ command: { file: process.execPath, args: [path.join(__dirname, 'fixtures/server.cjs')] },
        env: { ...process.env, CHATCODEX_FIXTURE_STATE: file } });
      const request = client.request.bind(client); client.request = (method, params, ...rest) => { calls.push({ method, params: structuredClone(params) }); return request(method, params, ...rest); };
      return client;
    }, ...extra });
    t.after(() => chat.close()); return chat;
  };
  return { make, values, calls, file, storage };
}
async function connect(chat) { chat.connect(chat.generation); await until(() => ['idle', 'error'].includes(chat.state)); }
async function send(chat, text) { chat.send(chat.generation, 'id-' + Date.now(), text); await until(() => ['idle', 'error'].includes(chat.state)); assert.equal(chat.state, 'idle', chat.detail); }
test('実stdio: 終了・再生成で最後の会話を復元し、同じthreadへ次の入力だけを送る', async t => {
  const c = fixture(t), first = c.make({ settings: { memoryMode: 'exclude' } }); await connect(first);
  await first.selectApproval(first.generation, 'full'); await send(first, '保存した会話');
  const thread = first.threadId, originalDefaults = structuredClone(first.threadDefaults);
  const stored = c.values.get('lastSession'); assert.equal(stored.inFlight, false);
  assert.equal(JSON.stringify(stored).includes('保存した会話'), false);
  await first.close(); c.calls.length = 0;
  const second = c.make({ settings: { memoryMode: 'include', sendOperationInstructions: false } }); await connect(second);
  assert.equal(second.state, 'idle', second.detail); assert.equal(second.threadId, thread);
  assert.match(second.sessionNotice, /そのまま/); assert.equal(second.read(0, 0).settingsPending, true);
  assert.deepEqual(second.threadDefaults, originalDefaults);
  assert.ok(second.entries.some(entry => entry.role === 'user' && entry.text === '保存した会話'));
  assert.ok(second.entries.some(entry => entry.role === 'assistant' && entry.text.includes('保存した会話')));
  assert.equal(c.calls.some(call => ['thread/start', 'turn/start'].includes(call.method)), false);
  const resume = c.calls.find(call => call.method === 'thread/resume').params;
  assert.deepEqual(resume.config, { 'memories.use_memories': false }); assert.match(resume.developerInstructions, /current-host/);
  await second.selectApproval(second.generation, 'inherit'); await send(second, '続きだけ');
  const turn = c.calls.filter(call => call.method === 'turn/start'); assert.equal(turn.length, 1);
  assert.deepEqual(turn[0].params.input, [{ type: 'text', text: '続きだけ' }]);
  assert.equal(turn[0].params.threadId, thread); assert.equal(turn[0].params.sandboxPolicy.type, 'readOnly');
  await second.newChat(second.generation); assert.equal(c.values.get('lastSession'), null); assert.equal(second.entries.length, 0);
  assert.ok(JSON.parse(fs.readFileSync(c.file)).threads[thread]);
});
test('実stdio: 承認待ち終了後は警告と履歴を復元し、古い承認カードを再利用しない', async t => {
  const c = fixture(t), first = c.make(); await connect(first);
  first.send(first.generation, 'approval', '承認待ちの中断'); await until(() => first.state === 'awaitingInput');
  assert.equal(c.values.get('lastSession').inFlight, true); await first.close(); c.calls.length = 0;
  const second = c.make(); await connect(second); assert.equal(second.state, 'idle', second.detail);
  assert.match(second.sessionNotice, /途中で終了/); assert.equal(second.requests.size, 0);
  assert.equal(c.calls.some(call => call.method === 'turn/start'), false);
  await send(second, '結果を確認したので続ける'); assert.equal(c.values.get('lastSession').inFlight, false);
  await second.close(); const third = c.make(); await connect(third);
  assert.match(third.sessionNotice, /そのまま/);
});
test('実stdio: 消失・不正な参照・別CODEX_HOMEでは自動で新規作成せず、明示的に解除できる', async t => {
  for (const kind of ['missing', 'invalid', 'scope']) {
    const c = fixture(t), first = c.make(); await connect(first); await send(first, '復元失敗の確認'); await first.close();
    const saved = c.values.get('lastSession');
    if (kind === 'missing') saved.threadId = 'missing-thread';
    if (kind === 'invalid') saved.schemaVersion = 99;
    if (kind === 'scope') saved.scope = '0'.repeat(64);
    c.calls.length = 0;
    const second = c.make(); await connect(second); assert.equal(second.state, 'error');
    assert.deepEqual(c.values.get('lastSession'), saved); assert.equal(c.calls.some(call => call.method === 'thread/start'), false);
    await second.newChat(second.generation); await until(() => second.state === 'idle');
    assert.equal(c.values.get('lastSession'), null); assert.equal(second.threadId, null);
  }
});
test('実stdio: 状態保存に失敗したらturn/start前に停止し、失敗した参照解除でも会話を保持する', async t => {
  const c = fixture(t); let fail = false;
  const chat = c.make({ storage: { get: c.storage.get, set: async (key, value) => {
    if (fail && key === 'lastSession') throw Error('fixture denied'); return c.storage.set(key, value);
  } } }); await connect(chat); fail = true;
  chat.send(chat.generation, 'save-fail', '未送信の入力'); await until(() => chat.state === 'error');
  assert.match(chat.detail, /保存領域/); assert.equal(c.calls.some(call => call.method === 'turn/start'), false);
  const generation = chat.generation; await assert.rejects(chat.newChat(generation), /保存領域/);
  assert.equal(chat.generation, generation); assert.ok(chat.entries.some(entry => entry.text === '未送信の入力'));
});
test('履歴は新しい200ターンまで表示し、カーソル循環では復元を中止する', async () => {
  let offset = 0;
  const history = await readHistory({ request: async () => {
    const data = Array.from({ length: 20 }, (_, n) => ({ id: String(250 - offset - n), items: [], status: 'completed' }));
    offset += 20; return { data, nextCursor: String(offset) };
  } }, 'fixture');
  assert.equal(history.turns.length, 200); assert.equal(history.omitted, true);
  assert.equal(history.turns[0].id, '51'); assert.equal(history.turns.at(-1).id, '250');
  await assert.rejects(readHistory({ request: async () => ({ data: [], nextCursor: 'same' }) }, 'fixture'), /表示位置/);
});
test('状態保存が応答しなくても終了待ちを1秒で打ち切る', async () => {
  const chat = new Chat({ storage: {} }); chat.sessions.pending = new Promise(() => {});
  const start = Date.now(); await chat.close();
  assert.ok(Date.now() - start < 1800);
});
