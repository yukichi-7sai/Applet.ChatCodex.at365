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
  assert.deepEqual(c.values.get('preferences'), { schemaVersion: 1, model: 'fixture-fast', effort: 'high' });
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
