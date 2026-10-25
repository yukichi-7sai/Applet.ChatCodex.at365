'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { Chat } = require('../src/chat.cjs');
const { CodexProcess } = require('../src/codex-process.cjs');
const { continuation, isContextLimit, handoffDraft } = require('../src/context-recovery.cjs');
async function until(check) { const end = Date.now() + 8000; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('Timed out'); }
function fixture(t) {
  const base = path.resolve(__dirname, '../.artifacts/context-tests'); fs.mkdirSync(base, { recursive: true });
  const folder = fs.mkdtempSync(path.join(base, 'case-')), file = path.join(folder, 'server.json'), values = new Map(), calls = [];
  const storage = { get: async key => values.get(key), set: async (key, value) => values.set(key, structuredClone(value)) };
  const make = (options = {}) => {
    const chat = new Chat({ storage, getHostInfo: async () => ({ instanceId: 'context-fixture' }), clientFactory: () => {
      const client = new CodexProcess({ command: { file: process.execPath, args: [path.join(__dirname, 'fixtures/server.cjs')] }, env: { ...process.env, CHATCODEX_FIXTURE_STATE: file } });
      const request = client.request.bind(client); client.request = (method, params, ...rest) => { calls.push({ method, params: structuredClone(params) }); return request(method, params, ...rest); };
      return client;
    }, ...options }); t.after(() => chat.close()); return chat;
  };
  const set = changes => { const data = JSON.parse(fs.readFileSync(file, 'utf8')); Object.assign(data, changes); fs.writeFileSync(file, JSON.stringify(data)); };
  return { make, values, calls, set, file, storage };
}
async function idle(chat) { await until(() => ['idle', 'error'].includes(chat.state) && !chat.usageOperation); assert.equal(chat.state, 'idle', chat.detail); }
async function connect(chat) { chat.connect(chat.generation); await idle(chat); }
async function send(chat, id, text) { chat.send(chat.generation, id, text); await idle(chat); }
test('コンテキスト上限だけを分類し、引き継ぎ下書きは会話の抜粋だけでUTF-8上限内に収める', () => {
  assert.equal(isContextLimit({ codexErrorInfo: 'contextWindowExceeded' }), true);
  assert.equal(isContextLimit({ message: 'contextWindowExceeded' }), false);
  assert.equal(isContextLimit({ codexErrorInfo: 'usageLimitExceeded' }), false);
  const entries = Array.from({ length: 10 }, (_, n) => ({ messageId: String(n), role: n % 2 ? 'assistant' : 'user', text: '😀'.repeat(10000) + n }));
  entries.push({ messageId: 'private', role: 'system', kind: 'trace', text: 'private-diagnostic-secret' });
  const draft = handoffDraft(entries, process.cwd());
  assert.ok(Buffer.byteLength(draft) < 32768); assert.equal(draft.includes('private-diagnostic-secret'), false);
  assert.equal(draft.includes('\ufffd'), false); assert.match(draft, /全文やAIによる要約ではありません/); assert.match(draft, /長い内容を省略/);
});
test('実stdio: 圧縮の受付だけでは完了とせず、同じ会話で明示的に1回だけ作業を再開する', async t => {
  const c = fixture(t), chat = c.make(); await connect(chat); await send(chat, 'limit', 'コンテキスト制限のテスト');
  const id = chat.contextRecovery.id, thread = chat.threadId; c.set({ compactMode: 'hold' });
  chat.compact(chat.generation, 'compact-once', id); chat.compact(chat.generation, 'compact-once', id);
  await until(() => !!chat.run?.turnId); assert.equal(chat.state, 'compacting'); assert.equal(chat.contextRecovery.status, 'compacting');
  assert.throws(() => chat.continueContext(chat.generation, 'early', id));
  const rejected = [], unsupported = chat.client.unsupported.bind(chat.client); chat.client.unsupported = value => { rejected.push(value); unsupported(value); };
  chat.serverRequest({ id: 'compact-approval', method: 'item/commandExecution/requestApproval', params: {} }); assert.deepEqual(rejected, ['compact-approval']);
  await chat.client.request('fixture/completeCompact', {}); await idle(chat);
  assert.equal(chat.contextRecovery.status, 'ready'); assert.equal(c.values.get('lastSession').contextRecovery.status, 'ready');
  assert.equal(chat.entries.some(entry => entry.role === 'assistant'), false);
  chat.continueContext(chat.generation, 'continue-once', id); await idle(chat); chat.continueContext(chat.generation, 'continue-once', id);
  const turns = c.calls.filter(call => call.method === 'turn/start'); assert.equal(turns.length, 2);
  assert.equal(turns[1].params.threadId, thread); assert.deepEqual(turns[1].params.input, [{ type: 'text', text: continuation }]);
  assert.equal(c.calls.filter(call => call.method === 'thread/compact/start').length, 1);
  assert.equal(chat.contextRecovery, null); assert.equal(c.values.get('lastSession').contextRecovery, undefined);
});
test('実stdio: 圧縮失敗・未対応・不完全な完了通知でも会話を残し、下書きを確認してから新しい会話へ引き継ぐ', async t => {
  for (const mode of ['fail', 'unsupported', 'incomplete']) {
    const c = fixture(t), chat = c.make(); await connect(chat); await send(chat, 'context', 'コンテキスト制限');
    const oldThread = chat.threadId, oldGeneration = chat.generation; c.set({ compactMode: mode });
    chat.compact(chat.generation, 'compact', chat.contextRecovery.id); await idle(chat); assert.equal(chat.contextRecovery.status, 'failed');
    const result = await chat.handoff(chat.generation, chat.contextRecovery.id);
    assert.ok(result.draft.includes('コンテキスト制限')); assert.equal(chat.entries.length, 0); assert.ok(chat.generation > oldGeneration);
    assert.equal(c.values.get('lastSession').threadId, oldThread); assert.equal(c.calls.filter(call => call.method === 'thread/start').length, 1);
    const next = c.make(); await connect(next); assert.equal(next.threadId, oldThread); await next.close();
    await send(chat, 'handoff-user', result.draft.replaceAll('コンテキスト制限', '以前の長い会話') + '\n未完了の作業を進めてください。');
    assert.notEqual(chat.threadId, oldThread); assert.equal(c.values.get('lastSession').cwd, process.cwd());
    assert.ok(JSON.parse(fs.readFileSync(c.file)).threads[oldThread]);
  }
});
test('実stdio: 圧縮中終了は結果不明として復元し、自動で圧縮・続行せず、停止操作も受け付ける', async t => {
  const c = fixture(t), first = c.make(); await connect(first); await send(first, 'limit', 'コンテキスト制限');
  c.set({ compactMode: 'hold' }); first.compact(first.generation, 'first-compact', first.contextRecovery.id); await until(() => !!first.run?.turnId);
  await first.close(); c.calls.length = 0; const next = c.make(); await connect(next);
  assert.equal(next.contextRecovery.status, 'unknown'); assert.equal(c.calls.some(call => call.method === 'thread/compact/start'), false);
  assert.throws(() => next.compact(next.generation - 1, 'old', next.contextRecovery.id));
  next.compact(next.generation, 'stop-compact', next.contextRecovery.id); await until(() => !!next.run?.turnId); next.stop(next.generation); await idle(next);
  assert.equal(next.contextRecovery.status, 'needed'); assert.equal(c.calls.some(call => call.method === 'turn/start'), false);
});
test('実stdio: 圧縮中の利用制限は回復確認後に圧縮から再開し、通常の続行へ飛ばさない', async t => {
  const c = fixture(t), chat = c.make(); await connect(chat); await send(chat, 'limit', 'コンテキスト制限');
  c.set({ compactMode: 'quota' }); chat.compact(chat.generation, 'compact-quota', chat.contextRecovery.id); await idle(chat);
  assert.equal(chat.pause.kind, 'usage'); assert.equal(chat.contextRecovery.status, 'failed');
  assert.throws(() => chat.resumeWork(chat.generation, 'wrong-continue', chat.pause.id), /先に会話を圧縮/);
  chat.compact(chat.generation, 'still-blocked', chat.contextRecovery.id); await idle(chat);
  assert.equal(c.calls.filter(call => call.method === 'thread/compact/start').length, 1);
  c.set({ compactMode: 'success', usage: { ordinaryUsageAllowed: true, rateLimits: {} } });
  chat.compact(chat.generation, 'recovered', chat.contextRecovery.id); await idle(chat); assert.equal(chat.contextRecovery.status, 'ready'); assert.equal(chat.pause, null);
  assert.equal(c.calls.filter(call => call.method === 'turn/start').length, 1);
});
test('実stdio: 保存失敗時は圧縮を送らず、RPC拒否された依頼は続行ボタンで再送しない', async t => {
  const c = fixture(t); let fail = false;
  const chat = c.make({ storage: { get: c.storage.get, set: (key, value) => { if (fail) throw Error('fixture storage unavailable'); return c.storage.set(key, value); } } });
  await connect(chat); await send(chat, 'rpc', 'RPCコンテキスト制限'); assert.equal(chat.contextRecovery.canContinue, false);
  assert.throws(() => chat.continueContext(chat.generation, 'unsafe', chat.contextRecovery.id));
  fail = true; chat.compact(chat.generation, 'save-failed', chat.contextRecovery.id); await until(() => chat.state === 'error');
  assert.equal(c.calls.some(call => call.method === 'thread/compact/start'), false);
});
