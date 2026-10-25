'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { Chat } = require('../src/chat.cjs');
const { CodexProcess } = require('../src/codex-process.cjs');
const { continuation, limitReason, usageSnapshot } = require('../src/usage.cjs');
const allowed = (value, extra = {}) => ({ ordinaryUsageAllowed: value, rateLimits: { limitId: 'codex', primary: { usedPercent: value ? 10 : 100, resetsAt: 1, windowDurationMins: 300 } }, ...extra });
async function until(check) {
  const end = Date.now() + 8000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw Error('Timed out');
}
function fixture(t) {
  const base = path.resolve(__dirname, '../.artifacts/usage-tests'); fs.mkdirSync(base, { recursive: true });
  const folder = fs.mkdtempSync(path.join(base, 'case-')), file = path.join(folder, 'server.json'), values = new Map(), calls = [];
  const storage = { get: async key => values.get(key), set: async (key, value) => values.set(key, structuredClone(value)) };
  const make = (options = {}) => {
    const chat = new Chat({ storage, getHostInfo: async () => ({ instanceId: 'fixture-host' }), clientFactory: () => {
      const client = new CodexProcess({ command: { file: process.execPath, args: [path.join(__dirname, 'fixtures/server.cjs')] }, env: { ...process.env, CHATCODEX_FIXTURE_STATE: file } });
      const request = client.request.bind(client); client.request = (method, params, ...rest) => { calls.push({ method, params: structuredClone(params) }); return request(method, params, ...rest); };
      return client;
    }, ...options }); t.after(() => chat.close()); return chat;
  };
  const usage = snapshot => { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); saved.usage = snapshot; fs.writeFileSync(file, JSON.stringify(saved)); };
  return { make, values, calls, usage, file, storage };
}
async function idle(chat) { await until(() => ['idle', 'error'].includes(chat.state) && !chat.usageOperation); assert.equal(chat.state, 'idle', chat.detail); }
async function connect(chat) { chat.connect(chat.generation); await idle(chat); }
async function send(chat, id, text) { chat.send(chat.generation, id, text); await idle(chat); }
test('利用制限とHTTP429だけを分類し、エラー本文・認証・コンテキスト上限は誤判定しない', () => {
  assert.equal(limitReason({ codexErrorInfo: 'usageLimitExceeded' }), 'usage');
  assert.equal(limitReason({ codexErrorInfo: 'UsageLimitExceeded' }), 'usage');
  assert.equal(limitReason({ codexErrorInfo: 'rateLimitExceeded' }), 'rate');
  assert.equal(limitReason({ codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 429 } } }), 'rate');
  for (const value of ['contextWindowExceeded', 'unauthorized', 'serverOverloaded']) assert.equal(limitReason({ codexErrorInfo: value }), null);
  assert.equal(limitReason({ message: 'usageLimitExceeded' }), null);
  assert.equal(limitReason({ codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 500 } } }), null);
});
test('利用率と経過時刻だけで回復を推測せず、Codexの利用許可と複数の制限を確認する', () => {
  assert.equal(usageSnapshot(allowed(false)).status, 'blocked');
  assert.equal(usageSnapshot(allowed(null)).status, 'unknown');
  assert.equal(usageSnapshot(allowed(true)).status, 'available');
  assert.equal(usageSnapshot({ ordinaryUsageAllowed: true, rateLimits: { primary: { usedPercent: 100, resetsAt: 1 } } }).status, 'available');
  assert.equal(usageSnapshot({ ordinaryUsageAllowed: true, rateLimitsByLimitId: { codex: allowed(true).rateLimits, other: { rateLimitReachedType: 'workspace_owner_usage_limit_reached' } } }).status, 'blocked');
  const windows = { rateLimits: { primary: { usedPercent: 100, resetsAt: 10 }, secondary: { usedPercent: 100, resetsAt: 20 } } };
  assert.equal(usageSnapshot(windows).nextReset, 20); windows.rateLimits.secondary.resetsAt = null;
  assert.equal(usageSnapshot(windows).nextReset, null);
  assert.throws(() => usageSnapshot({ rateLimits: { primary: { usedPercent: '100' } } }));
  const snapshot = usageSnapshot({ ...allowed(true), accountId: 'private-account', rateLimitUpsell: { apiKey: 'secret' } });
  assert.equal(JSON.stringify(snapshot).includes('private-account'), false); assert.equal(JSON.stringify(snapshot).includes('secret'), false);
});
test('実stdio: 制限停止と予定時刻を保持し、再確認・再開は元の入力を再送しない', async t => {
  const c = fixture(t), chat = c.make(); await connect(chat); await send(chat, 'first', '利用枠制限のテスト 終了情報なし');
  const thread = chat.threadId, pause = chat.pause.id;
  assert.equal(chat.pause.kind, 'usage'); assert.equal(chat.usage.status, 'blocked'); assert.ok(chat.usage.nextReset);
  assert.equal(c.values.get('lastSession').pause.id, pause); assert.equal(c.values.get('lastSession').inFlight, false);
  assert.equal(c.calls.filter(call => call.method === 'turn/start').length, 1);
  chat.resumeWork(chat.generation, 'blocked', pause); await idle(chat);
  assert.equal(c.calls.filter(call => call.method === 'turn/start').length, 1);
  c.usage(allowed(true)); chat.checkUsage(chat.generation); await idle(chat); assert.equal(chat.usage.status, 'available');
  c.usage(allowed(false)); chat.resumeWork(chat.generation, 'stale-availability', pause); await idle(chat);
  assert.equal(chat.usage.status, 'blocked'); assert.equal(c.calls.filter(call => call.method === 'turn/start').length, 1);
  c.usage(allowed(true)); chat.resumeWork(chat.generation, 'resume-once', pause); chat.resumeWork(chat.generation, 'resume-once', pause); await idle(chat);
  chat.resumeWork(chat.generation, 'resume-once', pause); await idle(chat);
  const turns = c.calls.filter(call => call.method === 'turn/start'); assert.equal(turns.length, 2);
  assert.equal(turns[1].params.threadId, thread); assert.deepEqual(turns[1].params.input, [{ type: 'text', text: continuation }]);
  assert.equal(chat.pause, null); assert.equal(c.values.get('lastSession').pause, undefined);
});
test('実stdio: Appletを再生成しても制限停止を復元し、明示的な再開だけを受け付ける', async t => {
  const c = fixture(t), first = c.make(); await connect(first); await send(first, 'limit', '利用枠制限');
  const id = first.threadId, originalDefaults = structuredClone(first.threadDefaults), previousGeneration = first.generation;
  await first.close(); c.calls.length = 0;
  const second = c.make(); await connect(second);
  assert.equal(second.threadId, id); assert.match(second.sessionNotice, /利用制限/); assert.equal(second.usage.status, 'blocked');
  assert.equal(c.calls.some(call => call.method === 'turn/start'), false);
  assert.throws(() => second.resumeWork(previousGeneration + 100, 'old', second.pause.id), /会話が切り替わり/);
  assert.throws(() => second.resumeWork(second.generation, 'old-pause', 'different'), /停止した作業/);
  c.usage(allowed(true)); second.resumeWork(second.generation, 'continued', second.pause.id); await idle(second);
  assert.equal(second.sessionNotice.includes('利用制限で停止'), false);
  assert.deepEqual(second.threadDefaults, originalDefaults); assert.equal(second.threadId, id);
  await second.newChat(second.generation); assert.equal(second.read(0, 0).usage, null);
  assert.ok(JSON.parse(fs.readFileSync(c.file)).threads[id]);
});
test('実stdio: 一時制限・時刻不明・確認失敗・古い通知でも回復を断定しない', async t => {
  const c = fixture(t), chat = c.make(); await connect(chat); await send(chat, 'temporary', '一時制限 時刻不明');
  assert.equal(chat.pause.kind, 'rate'); assert.equal(chat.usage.nextReset, null);
  c.usage({ fixtureError: true }); chat.checkUsage(chat.generation); await idle(chat); assert.equal(chat.usage.status, 'unavailable');
  c.usage(allowed(null)); chat.checkUsage(chat.generation); await idle(chat); assert.equal(chat.usage.status, 'unknown');
  chat.notification({ method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 0, resetsAt: 1 } } } });
  assert.equal(chat.usage.status, 'unknown');
  chat.resumeWork(chat.generation, 'unknown', chat.pause.id); await idle(chat);
  assert.equal(c.calls.filter(call => call.method === 'turn/start').length, 1);
  await send(chat, 'manual', '回復を確認したので別の相談をします'); assert.equal(chat.pause, null);
});
test('実stdio: 回復済みの再試行と一般エラーを制限停止へ変えず、RPC拒否では不明な依頼を自動再送しない', async t => {
  const c = fixture(t), chat = c.make(); await connect(chat);
  await send(chat, 'retry', '再試行から回復'); assert.equal(chat.pause, null);
  await send(chat, 'generic', '通常の失敗'); assert.equal(chat.pause, null);
  await send(chat, 'rpc', 'RPC利用制限'); assert.equal(chat.pause.kind, 'usage'); assert.equal(chat.pause.canContinue, false);
  assert.throws(() => chat.resumeWork(chat.generation, 'unsafe', chat.pause.id));
  assert.equal(JSON.stringify(chat.read(0, 0)).includes('fixture-limit-secret'), false);
});
test('実stdio: 利用状況の確認中に終了しても、遅れた成功応答から作業を再開しない', async t => {
  const c = fixture(t), chat = c.make(); await connect(chat); await send(chat, 'limit', '利用枠制限');
  const request = chat.client.request.bind(chat.client); let resolve;
  chat.client.request = (method, params, ...rest) => method === 'account/rateLimits/read' ? new Promise(done => { resolve = done; }) : request(method, params, ...rest);
  chat.resumeWork(chat.generation, 'closing', chat.pause.id); await until(() => !!resolve); await chat.close(); resolve(allowed(true));
  await until(() => !chat.usageOperation); assert.equal(c.calls.filter(call => call.method === 'turn/start').length, 1);
});
