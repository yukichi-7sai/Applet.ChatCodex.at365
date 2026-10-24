'use strict';
const fs = require('node:fs'), path = require('node:path');
const { CodexProcess, resolveCodex } = require('../src/codex-process.cjs');
const root = path.resolve(__dirname, '..');
const client = new CodexProcess();
const result = { fixture: false, version: '0.161.0', initialized: false, authenticated: false, modelCount: 0, agentMessageReceived: false, mcpCalls: [] };
let done, threadId, turnId;
const completion = new Promise(resolve => { done = resolve; });
client.on('request', msg => {
  // This probe only requests read-only information. It never grants execution or permissions.
  if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(msg.method)) client.respond(msg.id, { decision: 'decline' });
  else if (msg.method === 'mcpServer/elicitation/request') client.respond(msg.id, { action: 'cancel', content: null });
  else if (msg.method === 'item/permissions/requestApproval') client.respond(msg.id, { permissions: {}, scope: 'turn' });
  else client.unsupported(msg.id);
});
client.on('notification', ({ method, params: p = {} }) => {
  if (p.threadId && threadId && p.threadId !== threadId) return;
  if (method === 'item/completed' && p.item?.type === 'agentMessage') result.agentMessageReceived = typeof p.item.text === 'string' && !!p.item.text.trim();
  if (method === 'item/completed' && p.item?.type === 'mcpToolCall') result.mcpCalls.push({ server: p.item.server, tool: p.item.tool, status: p.item.status });
  if (method === 'turn/completed') { result.turnStatus = p.turn?.status; done(); }
});
(async () => {
  let timer;
  try {
    result.commandResolved = !!resolveCodex().file;
    await client.start(); result.initialized = true;
    const account = await client.request('account/read', { refreshToken: false });
    result.authenticated = !!account.account || account.requiresOpenaiAuth === false;
    const models = await client.request('model/list', { limit: 100, includeHidden: false });
    result.modelCount = models.data.length;
    const model = models.data.find(model => model.isDefault) || models.data[0];
    result.model = model.model;
    const thread = await client.request('thread/start', {
      model: model.model, cwd: root, ephemeral: true,
      developerInstructions: '接続試験です。AppDockのMCP情報取得だけを使用し、設定変更、コマンド実行、音声、ファイル操作は行わないでください。返答は短いテキストだけにしてください。',
    });
    if (thread.thread?.ephemeral !== true || thread.thread.path) throw Error('Test thread must not persist');
    result.ephemeralThread = true;
    threadId = thread.thread.id;
    const params = { threadId, model: model.model, input: [{ type: 'text', text: 'AppDockのMCPが接続できる場合は情報取得だけでバージョンを確認してください。変更や他の操作はせず、最後に接続確認結果を短く返してください。' }] };
    const choices = model.supportedReasoningEfforts.map(e => e.reasoningEffort);
    const effort = choices.includes('low') ? 'low' : model.defaultReasoningEffort;
    if (effort) params.effort = effort;
    const turn = await client.request('turn/start', params); turnId = turn.turn.id;
    timer = setTimeout(() => done(), 90000);
    await completion;
    result.ok = result.initialized && result.authenticated && result.agentMessageReceived && result.turnStatus === 'completed';
    if (!result.turnStatus) await client.request('turn/interrupt', { threadId, turnId }).catch(() => {});
  } finally {
    clearTimeout(timer); await client.close();
    const folder = path.join(root, '.artifacts', 'real-probe-' + Date.now());
    fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, folder }));
    if (!result.ok) process.exitCode = 1;
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
