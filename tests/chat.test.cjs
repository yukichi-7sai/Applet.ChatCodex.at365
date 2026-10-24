'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { Chat } = require('../src/chat.cjs');
const { CodexProcess } = require('../src/codex-process.cjs');
const path = require('node:path');
async function until(check) {
  const end = Date.now() + 8000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw Error('Timed out');
}
function context(overrides = {}) {
  const values = new Map(), clients = [];
  const chat = new Chat({
    storage: { get: async key => values.get(key), set: async (key, value) => values.set(key, value) },
    getHostInfo: async () => ({ instanceId: 'fixture-host' }),
    clientFactory: () => {
      const client = new CodexProcess({ command: { file: process.execPath, args: [path.join(__dirname, 'fixtures/server.cjs')] } });
      clients.push(client); return client;
    }, ...overrides,
  });
  return { chat, values, clients };
}
async function ready(c) { c.chat.connect(c.chat.generation); await until(() => ['idle', 'error'].includes(c.chat.state)); assert.equal(c.chat.state, 'idle', c.chat.detail); }
test('実stdio: 初期化・ページング・モデル既定と選択保存', async t => {
  const c = context(); t.after(() => c.chat.close()); await ready(c);
  assert.equal(c.chat.models.length, 2);
  assert.deepEqual(c.chat.selection, { model: 'fixture-fast', effort: 'low' });
  await c.chat.select(c.chat.generation, 'fixture-fast', 'high');
  assert.deepEqual(c.values.get('preferences'), { schemaVersion: 1, model: 'fixture-fast', effort: 'high', approvalMode: 'inherit' });
  await assert.rejects(c.chat.select(c.chat.generation, 'fixture-simple', 'high'));
});
test('実stdio: 継続・モデル思考量・最終itemの重複防止・新しい会話', async t => {
  const c = context(); t.after(() => c.chat.close()); await ready(c);
  await c.chat.select(c.chat.generation, 'fixture-fast', 'high');
  c.chat.send(c.chat.generation, 'first', 'こんにちは');
  await until(() => c.chat.state === 'idle');
  assert.equal(c.chat.entries.filter(entry => entry.role === 'assistant').map(entry => entry.text).join(''), '応答: こんにちは [fixture-fast/high]');
  const thread = c.chat.threadId;
  c.chat.send(c.chat.generation, 'second', '続き'); await until(() => c.chat.state === 'idle');
  assert.equal(c.chat.threadId, thread);
  const old = c.chat.generation;
  c.chat.newChat(old);
  assert.throws(() => c.chat.send(old, 'stale', '古い画面'));
  c.chat.send(c.chat.generation, 'third', '新しい会話'); await until(() => c.chat.state === 'idle');
  assert.notEqual(c.chat.threadId, thread);
});
test('実stdio: 承認要求の回答・古い回答の拒否', async t => {
  const c = context(); t.after(() => c.chat.close()); await ready(c);
  c.chat.send(c.chat.generation, 'approval', '承認を試す');
  await until(() => c.chat.state === 'awaitingInput');
  const id = [...c.chat.requests.keys()][0];
  assert.throws(() => c.chat.respond(c.chat.generation, id, '{"decision":"acceptForSession"}'));
  c.chat.respond(c.chat.generation, id, '{"decision":"accept"}');
  await until(() => c.chat.state === 'idle');
  assert.throws(() => c.chat.respond(c.chat.generation, id, '{"decision":"accept"}'));
});
test('実stdio: 質問の選択肢検証', async t => {
  const c = context(); t.after(() => c.chat.close()); await ready(c);
  c.chat.send(c.chat.generation, 'question', '質問を試す'); await until(() => c.chat.state === 'awaitingInput');
  const id = [...c.chat.requests.keys()][0];
  assert.throws(() => c.chat.respond(c.chat.generation, id, '{"answers":{"choice":"不正"}}'));
  c.chat.respond(c.chat.generation, id, '{"answers":{"choice":"短く"}}');
  await until(() => c.chat.state === 'idle');
});
test('実stdio: 停止と二重送信の拒否', async t => {
  const c = context(); t.after(() => c.chat.close()); await ready(c);
  c.chat.send(c.chat.generation, 'slow', '遅延');
  assert.deepEqual(c.chat.send(c.chat.generation, 'slow', '遅延'), { accepted: true });
  assert.throws(() => c.chat.send(c.chat.generation, 'slow', '違う文章'));
  assert.throws(() => c.chat.send(c.chat.generation, 'other', '別の文章'));
  await until(() => c.chat.run?.turnId);
  c.chat.stop(c.chat.generation); await until(() => c.chat.state === 'idle');
  assert.match(c.chat.detail, /停止/);
});
test('実stdio: 長文分割とカーソルの再取得', async t => {
  const c = context(); t.after(() => c.chat.close()); await ready(c);
  c.chat.send(c.chat.generation, 'long', '長文'); await until(() => c.chat.state === 'idle');
  const snapshot = c.chat.read(0, 0);
  assert.equal(snapshot.entries.filter(entry => entry.role === 'assistant').map(entry => entry.text).join(''), '文'.repeat(10000));
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 256 * 1024);
  assert.deepEqual(c.chat.read(c.chat.generation, snapshot.after).entries, []);
});
test('保存失敗時に選択を変えず、不正な保存値を自動修復しない', async t => {
  let saved = false;
  const c = context({ storage: { get: async () => ({ schemaVersion: 9 }), set: async () => { saved = true; throw Error('write'); } } });
  t.after(() => c.chat.close()); await ready(c);
  const original = { ...c.chat.selection };
  assert.equal(saved, false); assert.match(c.chat.detail, /保存/);
  await assert.rejects(c.chat.select(c.chat.generation, 'fixture-fast', 'high'));
  assert.deepEqual(c.chat.selection, original);
});
test('未提供モデルを別モデルへ自動変更しない', async t => {
  const c = context({ storage: { get: async () => ({ schemaVersion: 1, model: 'missing', effort: 'high' }), set: async () => {} } });
  t.after(() => c.chat.close()); await ready(c);
  assert.equal(c.chat.selection.model, 'missing');
  assert.throws(() => c.chat.send(c.chat.generation, 'a', 'text'));
});
test('未認証はチャットを開始しない', async t => {
  const fake = new EventEmitter(); fake.start = async () => {}; fake.close = async () => {};
  fake.request = async () => ({ account: null, requiresOpenaiAuth: true });
  const c = context({ clientFactory: () => fake }); t.after(() => c.chat.close());
  c.chat.connect(c.chat.generation); await until(() => c.chat.state === 'error');
  assert.match(c.chat.detail, /ログイン/);
});
test('32KiB超の入力・空入力は拒否', async t => {
  const c = context(); t.after(() => c.chat.close()); await ready(c);
  assert.throws(() => c.chat.send(c.chat.generation, 'big', '文'.repeat(11000)));
  assert.throws(() => c.chat.send(c.chat.generation, 'blank', ' \n '));
});
test('実stdio: 接続断で結果不明になり、自動再送しない', async t => {
  const c = context(); t.after(() => c.chat.close()); await ready(c);
  c.chat.send(c.chat.generation, 'slow', '遅延'); await until(() => c.chat.run?.turnId);
  c.clients[0].child.kill(); await until(() => c.chat.state === 'error');
  assert.equal(c.clients.length, 1); assert.equal(c.chat.run, null);
});
test('未対応のサーバー要求に応答し、別会話の完了通知を無視', async t => {
  const c = context(); t.after(() => c.chat.close()); await ready(c);
  c.chat.send(c.chat.generation, 'slow', '遅延'); await until(() => c.chat.run?.turnId);
  const old = c.chat.state;
  c.chat.notification({ method: 'turn/completed', params: { threadId: c.chat.threadId, turn: { id: 'foreign', status: 'completed' } } });
  assert.equal(c.chat.state, old);
  let rejected;
  c.chat.client.unsupported = id => { rejected = id; };
  c.chat.serverRequest({ id: 77, method: 'unknown', params: { threadId: c.chat.threadId } });
  assert.equal(rejected, 77);
});

test('実stdio: 4つの承認モードを同じ会話へ適用し、継承へ戻すと元の制限を復元', async t => {
  const c = context(); t.after(() => c.chat.close()); await ready(c);
  const sent = [], request = c.chat.client.request.bind(c.chat.client);
  c.chat.client.request = (method, params, ...rest) => { sent.push({ method, params: structuredClone(params) }); return request(method, params, ...rest); };
  for (const mode of ['inherit', 'ask', 'auto', 'full', 'inherit']) {
    await c.chat.selectApproval(c.chat.generation, mode);
    c.chat.send(c.chat.generation, mode + sent.length, 'モードの確認'); await until(() => c.chat.state === 'idle');
  }
  const turns = sent.filter(item => item.method === 'turn/start').map(item => item.params);
  assert.equal(sent.filter(item => item.method === 'thread/start').length, 1);
  assert.deepEqual(turns.map(p => [p.approvalPolicy, p.approvalsReviewer, p.sandboxPolicy.type]), [
    ['on-request', 'user', 'readOnly'], ['on-request', 'user', 'workspaceWrite'], ['on-request', 'auto_review', 'workspaceWrite'],
    ['never', 'user', 'dangerFullAccess'], ['on-request', 'user', 'readOnly'],
  ]);
  assert.equal(turns[1].sandboxPolicy.networkAccess, false);
  assert.deepEqual(turns[1].sandboxPolicy.writableRoots, []);
  assert.deepEqual(turns[4].sandboxPolicy, turns[0].sandboxPolicy);
  assert.equal(c.values.get('preferences').approvalMode, 'inherit');
  assert.equal(sent.some(item => /config\/.+write/i.test(item.method)), false);
});

test('旧保存値は継承で読み、未知の承認モードは選び直すまで送信しない', async t => {
  for (const approvalMode of [undefined, 'unknown']) {
    const saved = { schemaVersion: 1, model: 'fixture-fast', effort: 'low', ...(approvalMode ? { approvalMode } : {}) };
    let writes = 0;
    const c = context({ storage: { get: async () => saved, set: async () => writes++ } });
    t.after(() => c.chat.close()); await ready(c);
    assert.equal(writes, 0);
    assert.equal(c.chat.approvalMode, approvalMode ? '' : 'inherit');
    if (approvalMode) assert.throws(() => c.chat.send(c.chat.generation, 'unknown', 'text'));
  }
});

test('承認モードは保存成功後だけ変更し、実行中・不正値・古い世代を拒否', async t => {
  const c = context(); t.after(() => c.chat.close()); await ready(c);
  await assert.rejects(c.chat.selectApproval(c.chat.generation, 'unsafe'));
  await assert.rejects(c.chat.selectApproval(c.chat.generation - 1, 'full'));
  c.chat.storage.set = async () => { throw Error('save failure'); };
  await assert.rejects(c.chat.selectApproval(c.chat.generation, 'full'));
  assert.equal(c.chat.approvalMode, 'inherit');
  c.chat.send(c.chat.generation, 'running', '遅延');
  await assert.rejects(c.chat.selectApproval(c.chat.generation, 'full'));
  assert.equal(c.chat.run.approvalMode, 'inherit');
});

test('実stdio: Codex側がモードを拒否したら待機へ戻り、自動再送・緩和をしない', async t => {
  const c = context(); t.after(() => c.chat.close()); await ready(c);
  await c.chat.selectApproval(c.chat.generation, 'full');
  const sent = [], request = c.chat.client.request.bind(c.chat.client);
  c.chat.client.request = (method, params, ...rest) => { sent.push(method); return request(method, params, ...rest); };
  c.chat.send(c.chat.generation, 'denied', '制限拒否'); await until(() => c.chat.state === 'idle');
  assert.match(c.chat.detail, /承認モード/); assert.equal(c.chat.approvalMode, 'full');
  assert.equal(sent.filter(method => method === 'turn/start').length, 1);
  assert.equal(c.chat.entries.some(item => item.role === 'assistant'), false);
});

test('実stdio: 入力項目なしのMCP確認は画面へ待機し、明示的な回答だけを返す', async t => {
  const c = context(); t.after(() => c.chat.close()); await ready(c);
  const replies = [], respond = c.chat.client.respond.bind(c.chat.client);
  c.chat.client.respond = (id, result) => { replies.push(result); respond(id, result); };
  for (const decision of ['accept', 'decline', 'cancel']) {
    c.chat.send(c.chat.generation, decision, 'MCP確認'); await until(() => c.chat.state === 'awaitingInput');
    assert.equal(replies.length, ['accept', 'decline', 'cancel'].indexOf(decision));
    const request = [...c.chat.requests.values()][0]; assert.equal(request.view.kind, 'approval');
    c.chat.respond(c.chat.generation, request.view.id, JSON.stringify({ decision })); await until(() => c.chat.state === 'idle');
    assert.deepEqual(replies.at(-1), { action: decision, content: decision === 'accept' ? {} : null });
  }
});

test('開始指示とメモリ注入は会話単位で指定し、変更は次の新しいチャットへ反映', async t => {
  const c = context({ settings: { displayMode: 'detail', sendOperationInstructions: false, memoryMode: 'exclude' } });
  t.after(() => c.chat.close()); await ready(c);
  const starts = [], request = c.chat.client.request.bind(c.chat.client);
  c.chat.client.request = (method, params, ...rest) => { if (method === 'thread/start') starts.push(structuredClone(params)); return request(method, params, ...rest); };
  c.chat.send(c.chat.generation, 'without', '指示なしの確認'); await until(() => c.chat.state === 'idle');
  assert.equal(starts[0].developerInstructions, undefined);
  assert.deepEqual(starts[0].config, { 'memories.use_memories': false });
  c.chat.setSettings({ displayMode: 'trace', sendOperationInstructions: true, memoryMode: 'include' });
  assert.equal(c.chat.read(c.chat.generation, 0).settingsPending, true);
  c.chat.send(c.chat.generation, 'same', '同じ会話'); await until(() => c.chat.state === 'idle');
  assert.equal(starts.length, 1);
  c.chat.newChat(c.chat.generation);
  c.chat.send(c.chat.generation, 'with', '新しい会話'); await until(() => c.chat.state === 'idle');
  assert.match(starts[1].developerInstructions, /fixture-host/);
  assert.deepEqual(starts[1].config, { 'memories.use_memories': true });
  assert.equal(c.chat.read(c.chat.generation, 0).settingsPending, false);
});

test('通常は診断を記録せず、表示切替で開始時の自前情報を確認できる', async t => {
  const c = context(); t.after(() => c.chat.close()); await ready(c);
  c.chat.send(c.chat.generation, 'normal', '通常'); await until(() => c.chat.state === 'idle');
  assert.equal(c.chat.entries.some(entry => entry.kind), false);
  c.chat.setSettings({ displayMode: 'detail' });
  assert.ok(c.chat.entries.some(entry => entry.title === 'この会話の開始時の情報' && entry.text.includes('settings.json')));
  assert.equal(c.chat.entries.some(entry => entry.kind === 'trace'), false);
  c.chat.send(c.chat.generation, 'detail', 'MCP確認'); await until(() => c.chat.state === 'awaitingInput');
  assert.ok(c.chat.entries.some(entry => entry.title?.startsWith('Codexからの確認要求')));
  c.chat.respond(c.chat.generation, [...c.chat.requests.keys()][0], '{"decision":"accept"}');
  await until(() => c.chat.state === 'idle');
  assert.ok(c.chat.entries.some(entry => entry.title === '確認への回答'));
});

test('通信ログは認証応答を隠し、量を制限して会話を継続できる', async t => {
  const c = context({ settings: { displayMode: 'trace' } }); t.after(() => c.chat.close()); await ready(c);
  assert.ok(c.chat.entries.some(entry => entry.kind === 'trace' && entry.title.includes('initialize')));
  assert.ok(c.chat.entries.some(entry => entry.text.includes('認証・設定に関する通信本文')));
  for (let n = 0; n < 500; n++) c.chat.diagnostic('trace', 'large', { text: 'x'.repeat(16000) });
  assert.equal(c.chat.entries.filter(entry => entry.title === '詳細表示を省略').length, 1);
  c.chat.send(c.chat.generation, 'after-limit', '上限後'); await until(() => c.chat.state === 'idle');
  assert.ok(c.chat.entries.some(entry => entry.role === 'assistant' && entry.text.includes('上限後')));
  assert.ok(Buffer.byteLength(JSON.stringify(c.chat.read(0, 0))) < 256 * 1024);
});
