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
  const history = await readHistory({ request: async method => {
    if (method === 'thread/items/list') return { data: [], nextCursor: null };
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

test('履歴は本文なしのターンと項目1件ずつで読み、長い本文を表示用に収める', async () => {
  const calls = [], long = '文'.repeat(1024 * 1024 + 100);
  const items = [{ type: 'userMessage', content: [{ type: 'text', text: '最初の依頼' }] },
    { type: 'mcpToolCall', result: 'ignored private tool result' }, { type: 'agentMessage', text: long }];
  const history = await readHistory({ request: async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/turns/list') { assert.equal(params.itemsView, 'notLoaded'); return { data: [{ id: 't', status: 'failed' }], nextCursor: null }; }
    assert.equal(params.limit, 1); assert.equal(params.turnId, 't');
    const offset = Number(params.cursor || 0), data = [...items].reverse().slice(offset, offset + 1);
    return { data: data.map(item => ({ turnId: 't', item })), nextCursor: offset < 2 ? String(offset + 1) : null };
  } }, 'thread');
  assert.equal(calls.length, 4); assert.equal(history.lastStatus, 'failed');
  assert.equal(history.turns[0].items.length, 2); assert.equal(history.turns[0].items[0].content[0].text, '最初の依頼');
  assert.equal(history.turns[0].items[1].text.length, 1024 * 1024); assert.equal(history.turns[0].items[1].truncated, true);
  assert.equal(JSON.stringify(history).includes('ignored private tool result'), false); assert.equal(items[2].text, long);
});

test('項目ページング未対応では全文を1ターンずつ取得し、古い保存方式でも復元する', async () => {
  const full = [], history = await readHistory({ request: async (method, params) => {
    if (method === 'thread/items/list') throw Object.assign(Error('unsupported'), { code: -32601 });
    if (params.itemsView === 'notLoaded') return { data: [{ id: 'new', status: 'completed' }], nextCursor: null };
    assert.equal(params.limit, 1); full.push(params.cursor);
    const id = params.cursor ? 'old' : 'new';
    return { data: [{ id, status: 'completed', items: [{ type: 'agentMessage', text: id }] }], nextCursor: params.cursor ? null : 'older' };
  } }, 'thread');
  assert.deepEqual(full, [null, 'older']); assert.deepEqual(history.turns.map(turn => turn.id), ['old', 'new']);
});

test('履歴の要求件数・表示バイトを制限し、終了後の追加取得と項目カーソル循環を防ぐ', async () => {
  let calls = 0;
  const history = await readHistory({ request: async method => {
    calls++; return method === 'thread/turns/list' ? { data: [{ id: 't', status: 'completed' }] }
      : { data: [{ turnId: 't', item: { type: 'mcpToolCall' } }], nextCursor: String(calls) };
  } }, 'thread');
  assert.equal(calls, 240); assert.equal(history.omitted, true);
  let canceledCalls = 0;
  await assert.rejects(readHistory({ request: async () => canceledCalls++ }, 'thread', () => false), /中止/); assert.equal(canceledCalls, 0);
  await assert.rejects(readHistory({ request: async method => method === 'thread/turns/list' ? { data: [{ id: 't' }] }
    : { data: [], nextCursor: 'loop' } }, 'thread'), /表示位置/);
  let offset = 0;
  const bounded = await readHistory({ request: async method => method === 'thread/turns/list' ? { data: [{ id: 't', status: 'failed' }] }
    : { data: [{ turnId: 't', item: { type: 'agentMessage', text: '文'.repeat(1024 * 1024) } }], nextCursor: String(++offset) } }, 'thread');
  assert.equal(bounded.omitted, true); assert.equal(bounded.lastStatus, 'failed');
  assert.ok(Buffer.byteLength(JSON.stringify(bounded.turns[0].items)) <= 6 * 1024 * 1024);
});

test('実stdio: 履歴取得だけが失敗しても会話を復元し、次の入力だけを同じ会話へ送る', async t => {
  const c = fixture(t), first = c.make(); await connect(first); await send(first, '履歴がない表示の試験'); await first.close();
  const state = JSON.parse(fs.readFileSync(c.file)); state.historyMode = 'unavailable'; fs.writeFileSync(c.file, JSON.stringify(state));
  const saved = structuredClone(c.values.get('lastSession')); c.calls.length = 0;
  const second = c.make(); await connect(second); assert.equal(second.state, 'idle', second.detail);
  assert.equal(second.threadId, saved.threadId); assert.match(second.historyNotice, /表示を省略/); assert.equal(second.entries.length, 0);
  assert.deepEqual(c.values.get('lastSession'), saved); assert.equal(c.calls.some(call => ['thread/start','turn/start'].includes(call.method)), false);
  await send(second, '確認してから続きを進めてください');
  assert.equal(second.threadId, saved.threadId); assert.equal(c.calls.filter(call => call.method === 'turn/start').length, 1);
});

test('実stdio: 巨大な履歴で切断した後は、明示操作だけで本文なしの復元を行う', async t => {
  const c = fixture(t), first = c.make(); await connect(first); await send(first, '巨大履歴の復旧試験'); await first.close();
  const state = JSON.parse(fs.readFileSync(c.file)); state.historyMode = 'oversized'; fs.writeFileSync(c.file, JSON.stringify(state));
  const saved = structuredClone(c.values.get('lastSession')); c.calls.length = 0;
  const second = c.make(); await connect(second); assert.equal(second.state, 'error');
  assert.equal(second.read(0,0).canRestoreWithoutHistory, true); assert.deepEqual(c.values.get('lastSession'), saved);
  const old = second.generation; assert.throws(() => second.connect(old-1, true));
  c.calls.length = 0; second.connect(old, true); await until(() => ['idle','error'].includes(second.state));
  assert.equal(second.state, 'idle', second.detail); assert.equal(second.threadId, saved.threadId); assert.match(second.historyNotice, /表示を省略/);
  assert.equal(c.calls.some(call => ['thread/items/list','thread/turns/list','turn/start','thread/start'].includes(call.method)), false);
  assert.deepEqual(c.values.get('lastSession'), saved); await send(second, '実行結果を確認して続行してください');
  assert.equal(second.threadId, saved.threadId);
});

test('実stdio: 会話自体が活動中・消失・別保存先なら本文なしの復元も許可しない', async t => {
  const c = fixture(t), first = c.make(); await connect(first); await send(first, '活動中の復元禁止'); await first.close();
  const state = JSON.parse(fs.readFileSync(c.file)), saved = structuredClone(c.values.get('lastSession'));
  state.threads[saved.threadId].status = { type: 'active' }; fs.writeFileSync(c.file, JSON.stringify(state));
  const second = c.make(); await connect(second); assert.equal(second.state, 'error');
  assert.equal(second.read(0,0).canRestoreWithoutHistory, false); assert.throws(() => second.connect(second.generation, true));
  assert.deepEqual(c.values.get('lastSession'), saved);
});
