'use strict';
// Persistent native tests use an isolated CODEX_HOME and a loopback-only Responses fixture.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Chat } = require('../src/chat.cjs');
const { CodexProcess, resolveCodex } = require('../src/codex-process.cjs');
const usageMode = process.argv.includes('--usage');
const contextMode = process.argv.includes('--context');
const outputMode = process.argv.includes('--output');
const historyMode = process.argv.includes('--history');
const root = path.resolve(__dirname, '..'), folder = path.join(root, '.artifacts', (historyMode ? 'history-probe-' : outputMode ? 'output-probe-' : contextMode ? 'context-probe-' : usageMode ? 'usage-probe-' : 'resume-probe-') + Date.now());
const home = path.join(folder, 'codex-home'), workspace = path.join(folder, 'workspace'), storageFile = path.join(folder, 'storage.json');
fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(workspace, { recursive: true });
const command = resolveCodex(), calls = [], requests = [];
let recovered = false;
const env = { ...process.env, CODEX_HOME: home, CODEX_SQLITE_HOME: home, OPENAI_API_KEY: '', CODEX_API_KEY: '' };
delete env.OPENAI_BASE_URL;
const storage = {
  get: async key => fs.existsSync(storageFile) ? JSON.parse(fs.readFileSync(storageFile, 'utf8'))[key] : undefined,
  set: async (key, value) => {
    const data = fs.existsSync(storageFile) ? JSON.parse(fs.readFileSync(storageFile, 'utf8')) : {};
    data[key] = value; fs.writeFileSync(storageFile, JSON.stringify(data));
  },
};
const server = http.createServer(async (request, response) => {
  assert.equal(request.headers.authorization, undefined, 'isolated provider must not receive credentials');
  assert.ok(request.url.startsWith('/v1/responses'));
  let body = ''; for await (const part of request) { body += part; assert.ok(body.length < (historyMode ? 32 : 4) * 1024 * 1024); }
  requests.push(JSON.parse(body));
  if (contextMode && requests.length === 1) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end('data: ' + JSON.stringify({ type: 'response.failed', sequence_number: 1, response: { id: 'resp_context_fixture', object: 'response', status: 'failed', error: { code: 'context_length_exceeded', message: 'Isolated fixture context window exceeded' } } }) + '\n\n'); return;
  }
  if (usageMode && requests.length === 1) {
    response.writeHead(429, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Isolated fixture rate limit', type: 'rate_limit_error', code: 'rate_limit_exceeded' } })); return;
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const text = outputMode && requests.length === 1 ? 'RESUME_FIRST_OK\n' + 'x'.repeat(1024 * 1024 + 512) + '\nNATIVE_HIDDEN_TAIL' : contextMode && requests.length === 2 ? 'COMPACTED_SUMMARY: preserve original task ISOLATED_RESUME_USER_FIRST; continue unfinished work.' : requests.length === 1 ? 'RESUME_FIRST_OK' : 'RESUME_CONTINUED_OK';
  const output = Array.from({ length: historyMode && requests.length === 1 ? 3 : 1 }, (_, index) => ({ id: 'msg_fixture_' + requests.length + '_' + index, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: historyMode && requests.length === 1 ? text + '\n' + 'x'.repeat(3 * 1024 * 1024) + '\nHISTORY_HIDDEN_TAIL_' + index : text, annotations: [] }] }));
  const emit = event => response.write('data: ' + JSON.stringify(event) + '\n\n');
  emit({ type: 'response.created', response: { id: 'resp_fixture_' + requests.length } });
  for (const [index,item] of output.entries()) {
    emit({ type: 'response.output_item.added', output_index: index, item: { ...item, status: 'in_progress', content: [] } });
    emit({ type: 'response.output_text.delta', item_id: item.id, output_index: index, content_index: 0, delta: item.content[0].text });
    emit({ type: 'response.output_item.done', output_index: index, item });
  }
  emit({ type: 'response.completed', response: { id: 'resp_fixture_' + requests.length, status: 'completed', output, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
  response.end();
});
const make = () => new Chat({ storage, settings: { sendOperationInstructions: false, memoryMode: 'exclude' },
  getHostInfo: async () => ({ instanceId: 'isolated-resume-fixture' }), clientFactory: () => {
    const client = new CodexProcess({ command, env, cwd: workspace });
    if (contextMode) client.on('notification', message => { if (message.method === 'error') result.nativeErrorInfo = message.params?.error?.codexErrorInfo; });
    const request = client.request.bind(client);
    client.request = (method, params, ...rest) => {
      if (method === 'thread/start') params = { ...params, cwd: workspace };
      if (usageMode && method === 'account/rateLimits/read') return Promise.resolve({ ordinaryUsageAllowed: recovered,
        rateLimits: { limitId: 'codex', primary: { usedPercent: recovered ? 0 : 100, resetsAt: Math.floor(Date.now() / 1000) + 3600 } } });
      calls.push({ method, params });
      return request(method, params, ...rest).then(value => {
        if (historyMode && method === 'thread/items/list') {
          const bytes = Buffer.byteLength(JSON.stringify(value));
          result.historyFetchedBytes = (result.historyFetchedBytes || 0) + bytes;
          result.largestHistoryReplyBytes = Math.max(result.largestHistoryReplyBytes || 0, bytes);
        }
        return value;
      });
    };
    return client;
  } });
async function until(check) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw Error('Native resume fixture timed out');
}
async function connect(chat) { chat.connect(chat.generation); await until(() => ['idle', 'error'].includes(chat.state) && !chat.usageOperation); assert.equal(chat.state, 'idle', chat.detail); }
async function send(chat, id, text) { chat.send(chat.generation, id, text); await until(() => ['idle', 'error'].includes(chat.state) && !chat.usageOperation); assert.equal(chat.state, 'idle', chat.detail); }
let first, second;
const result = { ok: false, isolatedCodexHome: true, localMockProvider: true, realModelUsed: false, rateLimitApiMocked: usageMode };
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(home, 'config.toml'), 'model="gpt-6.1-sol"\nmodel_provider="fixture"\ncli_auth_credentials_store="file"\n' + (historyMode ? 'model_context_window=100000000\nmodel_auto_compact_token_limit=100000000\n' : '') + '[model_providers.fixture]\nname="Fixture"\nbase_url="http://127.0.0.1:' + server.address().port + '/v1"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\nrequest_max_retries=0\nstream_max_retries=0\n');
  try {
    first = make(); await connect(first);
    const model = first.models.find(item => item.model === 'gpt-6.1-sol'); assert.ok(model);
    await first.select(first.generation, model.model, model.efforts.includes('low') ? 'low' : model.efforts[0] || '');
    await first.selectApproval(first.generation, 'full');
    await send(first, 'first', 'ISOLATED_RESUME_USER_FIRST');
    const threadId = first.threadId, defaults = structuredClone(first.threadDefaults);
    if (usageMode) { assert.ok(first.pause); assert.equal(first.usage.status, 'blocked'); result.nativeLimitKind = first.pause.kind; }
    else if (contextMode) { assert.equal(first.contextRecovery?.status, 'needed'); result.contextLimitDetected = true; }
    else assert.ok(first.entries.some(entry => entry.text.includes('RESUME_FIRST_OK')));
    if (outputMode) {
      assert.equal(first.read(0, 0).replyOmitted, true); assert.equal(calls.some(call => call.method === 'turn/interrupt'), false);
      assert.ok(first.entries.filter(entry => entry.role === 'assistant').reduce((sum, entry) => sum + entry.text.length, 0) <= 1024 * 1024);
      result.longReplyContinuedWithoutInterrupt = true;
    }
    await first.close(); calls.length = 0;
    second = make(); await connect(second);
    assert.equal(second.threadId, threadId); assert.deepEqual(second.threadDefaults, defaults);
    assert.ok(second.entries.some(entry => entry.role === 'user' && entry.text.includes('ISOLATED_RESUME_USER_FIRST')));
    if (usageMode) { assert.ok(second.pause); assert.equal(second.usage.status, 'blocked'); }
    else if (contextMode) assert.equal(second.contextRecovery?.status, 'needed');
    else assert.ok(second.entries.some(entry => entry.role === 'assistant' && entry.text.includes('RESUME_FIRST_OK')));
    if (historyMode) {
      assert.ok(result.historyFetchedBytes > 8 * 1024 * 1024); assert.ok(result.largestHistoryReplyBytes < 8 * 1024 * 1024);
      assert.equal(second.read(0,0).replyOmitted, true); assert.equal(second.historyNotice, '');
      assert.equal(calls.some(call => call.method === 'thread/turns/list' && call.params.itemsView === 'full'), false);
      result.largeHistoryRestoredInSmallPages = true;
    }
    assert.equal(requests.length, 1); assert.equal(calls.some(call => call.method === 'turn/start'), false);
    if (outputMode) { assert.equal(second.read(0, 0).replyOmitted, true); result.longReplyRestoredWithinLimit = true; }
    await second.selectApproval(second.generation, 'inherit');
    if (usageMode) {
      recovered = true; second.resumeWork(second.generation, 'continued', second.pause.id);
      await until(() => !second.pause && second.state === 'idle' && !second.usageOperation);
    } else if (contextMode) {
      second.compact(second.generation, 'compact', second.contextRecovery.id);
      await until(() => second.contextRecovery?.status === 'ready' && second.state === 'idle');
      assert.equal(requests.length, 2); assert.equal(calls.some(call => call.method === 'turn/start'), false);
      await second.close(); second = make(); await connect(second);
      assert.equal(second.contextRecovery?.status, 'ready'); assert.equal(second.threadId, threadId);
      second.continueContext(second.generation, 'continued', second.contextRecovery.id);
      await until(() => !second.contextRecovery && second.state === 'idle');
      result.compactionCompletedAndRestored = true;
    } else await send(second, 'continued', 'ISOLATED_RESUME_USER_CONTINUED');
    assert.equal(second.threadId, threadId); assert.equal(requests.length, contextMode ? 3 : 2);
    const input = JSON.stringify(requests.at(-1).input);
    const required = contextMode ? ['COMPACTED_SUMMARY', require('../src/context-recovery.cjs').continuation] : usageMode ? ['ISOLATED_RESUME_USER_FIRST', require('../src/usage.cjs').continuation] : ['ISOLATED_RESUME_USER_FIRST', 'RESUME_FIRST_OK', 'ISOLATED_RESUME_USER_CONTINUED'];
    for (const text of required) assert.ok(input.includes(text), text);
    if (outputMode) { assert.ok(input.includes('NATIVE_HIDDEN_TAIL')); assert.equal(calls.some(call => call.method === 'turn/interrupt'), false); result.hiddenOutputRemainsInCodexContext = true; }
    if (historyMode) { for (let index=0;index<3;index++) assert.ok(input.includes('HISTORY_HIDDEN_TAIL_' + index)); result.fullNativeHistoryPreserved = true; }
    if (!contextMode) assert.equal(input.split('ISOLATED_RESUME_USER_FIRST').length - 1, 1);
    assert.ok(second.entries.some(entry => entry.text.includes('RESUME_CONTINUED_OK')));
    assert.equal(calls.find(call => call.method === 'turn/start').params.sandboxPolicy.type, defaults.sandboxPolicy.type);
    Object.assign(result, { ok: true, codexVersion: execFileSync(command.file, [...command.args, '--version'], { encoding: 'utf8', windowsHide: true }).trim(), codexSha256: createHash('sha256').update(fs.readFileSync(command.file)).digest('hex'),
      restoredMessages: usageMode || contextMode ? 1 : 2, providerRequests: requests.length, historyPreservedInNextInput: true, automaticReplay: false, originalInheritanceRestored: true });
  } finally {
    await first?.close(); await second?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(folder, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ ...result, folder }));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
