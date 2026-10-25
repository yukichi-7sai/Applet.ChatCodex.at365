'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { Chat } = require('../src/chat.cjs');
const { scopeFor } = require('../src/session.cjs');
const limit = 1024 * 1024;
async function until(check) {
  const end = Date.now() + 3000;
  while (Date.now() < end) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw Error('Timed out');
}
function fixture(t, history = []) {
  const values = new Map(), calls = [];
  const defaults = { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: { type: 'readOnly' } };
  const client = new EventEmitter(); client.env = {};
  client.start = async () => {};
  client.close = async () => {};
  client.send = message => calls.push({ method: message.method, params: message.params });
  client.request = async (method, params) => {
    calls.push({ method, params: structuredClone(params) });
    if (method === 'account/read') return { requiresOpenaiAuth: false };
    if (method === 'model/list') return { data: [{ model: 'fixture-model', displayName: 'Fixture', isDefault: true, supportedReasoningEfforts: [] }] };
    if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: 'fixture-thread', status: { type: 'idle' } }, cwd: params.cwd, ...defaults };
    if (method === 'thread/turns/list') return { data: history, nextCursor: null };
    if (method === 'thread/items/list') {
      const items = [...history.find(turn => turn.id === params.turnId).items].reverse(), offset = Number(params.cursor || 0);
      return { data: items.slice(offset, offset + params.limit).map(item => ({ turnId: params.turnId, item })), nextCursor: offset + params.limit < items.length ? String(offset + params.limit) : null };
    }
    if (method === 'turn/start') return { turn: { id: 'turn-' + calls.filter(call => call.method === method).length } };
    throw Error('Unexpected fixture method: ' + method);
  };
  const chat = new Chat({ storage: { get: async key => values.get(key), set: async (key, value) => values.set(key, structuredClone(value)) },
    getHostInfo: async () => ({ instanceId: 'output-limit-fixture' }), clientFactory: () => client });
  t.after(() => chat.close());
  const notify = (method, params) => client.emit('notification', { method, params: { threadId: chat.threadId, turnId: chat.run?.turnId, ...params } });
  const saved = { schemaVersion: 1, threadId: 'fixture-thread', cwd: process.cwd(), scope: scopeFor(client.env),
    options: { sendOperationInstructions: true, memoryMode: 'inherit' },
    defaults: { approvalPolicy: defaults.approvalPolicy, approvalsReviewer: defaults.approvalsReviewer, sandboxPolicy: defaults.sandbox }, inFlight: false };
  return { chat, values, calls, notify, saved };
}
async function ready(c) { c.chat.connect(c.chat.generation); await until(() => ['idle', 'error'].includes(c.chat.state)); assert.equal(c.chat.state, 'idle', c.chat.detail); }
async function start(c, requestId, text) { c.chat.send(c.chat.generation, requestId, text); await until(() => !!c.chat.run?.turnId || c.chat.state === 'error'); assert.equal(c.chat.state, 'running', c.chat.detail); }
async function finish(c) { c.notify('turn/completed', { turn: { id: c.chat.run.turnId, status: 'completed' } }); await until(() => c.chat.state === 'idle'); }
const parts = (c, id) => c.chat.entries.filter(entry => entry.role === 'assistant' && entry.messageId === id);

test('長い返答は保存前に表示上限へ収め、Codexを止めずに次の作業と入力を続ける', async t => {
  const c = fixture(t); await ready(c); await start(c, 'first', '長い返答の後も作業を続けてください');
  c.notify('item/agentMessage/delta', { itemId: 'long', delta: '文'.repeat(limit - 2) });
  c.notify('item/agentMessage/delta', { itemId: 'long', delta: '文'.repeat(50) });
  c.notify('item/agentMessage/delta', { itemId: 'long', delta: '省略する続き'.repeat(100) });
  assert.equal(parts(c, 'long').map(part => part.text).join('').length, limit);
  assert.equal(parts(c, 'long').at(-1).truncated, true);
  assert.equal(c.chat.read(0, 0).replyOmitted, true);
  assert.equal(c.chat.state, 'running'); assert.equal(c.calls.some(call => call.method === 'turn/interrupt'), false);
  c.notify('item/completed', { item: { id: 'long', type: 'agentMessage', text: '文'.repeat(limit + 100) } });
  c.notify('item/completed', { item: { id: 'after-long', type: 'agentMessage', text: '長い出力の後の作業も完了しました。' } });
  await finish(c);
  assert.equal(parts(c, 'long').map(part => part.text).join(''), '文'.repeat(limit));
  assert.equal(parts(c, 'long').at(-1).truncated, true);
  assert.equal(parts(c, 'after-long').map(part => part.text).join(''), '長い出力の後の作業も完了しました。');
  assert.equal(c.values.get('lastSession').inFlight, false);
  await start(c, 'next', '次の作業をお願いします');
  c.notify('item/completed', { item: { id: 'next-reply', type: 'agentMessage', text: '次の作業も完了しました。' } }); await finish(c);
  const turns = c.calls.filter(call => call.method === 'turn/start');
  assert.equal(turns.length, 2); assert.equal(turns[0].params.threadId, turns[1].params.threadId);
  assert.deepEqual(turns[1].params.input, [{ type: 'text', text: '次の作業をお願いします' }]);
  assert.equal(c.calls.some(call => call.method === 'turn/interrupt'), false);
  await c.chat.newChat(c.chat.generation); assert.equal(c.chat.read(0, 0).replyOmitted, false);
});

test('表示上限ちょうどでは省略せず、最終itemだけの超過でも絵文字を壊さず明示する', async t => {
  const c = fixture(t); await ready(c); await start(c, 'boundary', '表示上限の境界を確認してください');
  c.notify('item/agentMessage/delta', { itemId: 'exact', delta: 'a'.repeat(limit) });
  c.notify('item/completed', { item: { id: 'exact', type: 'agentMessage', text: 'a'.repeat(limit) } });
  assert.equal(parts(c, 'exact').map(part => part.text).join('').length, limit);
  assert.equal(parts(c, 'exact').some(part => part.truncated), false); assert.equal(c.chat.read(0, 0).replyOmitted, false);
  c.notify('item/agentMessage/delta', { itemId: 'emoji-delta', delta: 'b'.repeat(limit - 1) + '😀Z' });
  c.notify('item/agentMessage/delta', { itemId: 'emoji-delta', delta: '続' });
  assert.equal(parts(c, 'emoji-delta').map(part => part.text).join(''), 'b'.repeat(limit - 1));
  assert.equal(parts(c, 'emoji-delta').at(-1).truncated, true);
  c.notify('item/completed', { item: { id: 'final-only', type: 'agentMessage', text: 'b'.repeat(limit - 1) + '😀' } });
  const text = parts(c, 'final-only').map(part => part.text).join('');
  assert.ok(text.length <= limit); assert.equal(/[\uD800-\uDBFF]$/.test(text), false);
  assert.equal(parts(c, 'final-only').at(-1).truncated, true); assert.equal(c.chat.read(0, 0).replyOmitted, true);
  assert.equal(c.chat.state, 'running'); await finish(c);
});

test('復元した長い返答も表示だけ省略し、過去の入力を再送せず同じ会話を続ける', async t => {
  const long = '履'.repeat(limit + 10), history = [{ id: 'saved-turn', status: 'completed', items: [
    { id: 'saved-user', type: 'userMessage', content: [{ type: 'text', text: '保存済みの依頼' }] },
    { id: 'saved-reply', type: 'agentMessage', text: long },
    { id: 'saved-short', type: 'agentMessage', text: '保存済みの完了結果' },
  ] }];
  const c = fixture(t, history); c.values.set('lastSession', c.saved); await ready(c);
  const replies = c.chat.entries.filter(entry => entry.role === 'assistant'), restored = replies.map(entry => entry.text).join('');
  assert.ok(restored.includes('保存済みの完了結果'));
  assert.equal(replies.filter(entry => entry.text.startsWith('履')).map(entry => entry.text).join('').length, limit);
  assert.equal(replies.some(entry => entry.truncated), true); assert.equal(c.chat.read(0, 0).replyOmitted, true);
  assert.equal(c.calls.some(call => call.method === 'turn/start'), false); assert.equal(history[0].items[1].text, long);
  await start(c, 'after-restore', '未完了の作業を確認してください');
  c.notify('item/completed', { item: { id: 'continued', type: 'agentMessage', text: '続きを確認しました。' } }); await finish(c);
  const turns = c.calls.filter(call => call.method === 'turn/start'); assert.equal(turns.length, 1); assert.equal(turns[0].params.threadId, c.saved.threadId);
  assert.deepEqual(turns[0].params.input, [{ type: 'text', text: '未完了の作業を確認してください' }]);
});
