'use strict';
const readline = require('node:readline');
const fs = require('node:fs');
const stateFile = process.env.CHATCODEX_FIXTURE_STATE;
let saved = { thread: 0, turn: 0, threads: {} };
if (stateFile && fs.existsSync(stateFile)) saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const persist = () => { saved.thread = thread; saved.turn = turn; if (stateFile) fs.writeFileSync(stateFile, JSON.stringify(saved)); };
let thread = 0, turn = 0, current, timer, waiting;
thread = saved.thread; turn = saved.turn;
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const notify = (method, params) => send({ method, params });
function failTurn(codexErrorInfo, completionInfo = true) {
  const error = { message: 'Fixture failure', codexErrorInfo };
  const record = saved.threads[current.thread]?.turns.at(-1);
  if (record) { record.status = 'failed'; record.error = error; persist(); }
  notify('error', { threadId: current.thread, turnId: current.turn, error, willRetry: false });
  notify('turn/completed', { threadId: current.thread, turn: { id: current.turn, status: 'failed', error: completionInfo ? error : { message: error.message } } }); current = null;
}
function finishCompact(completeItem = true) {
  if (!current?.compact) return;
  clearTimeout(timer);
  const record = saved.threads[current.thread]?.turns.at(-1);
  if (record) { record.status = 'completed'; persist(); }
  if (completeItem) notify('item/completed', { threadId: current.thread, turnId: current.turn, item: { type: 'contextCompaction', id: current.item } });
  notify('turn/completed', { threadId: current.thread, turn: { id: current.turn, status: 'completed' } }); current = null;
}
function finish(text) {
  if (!current) return;
  const record = saved.threads[current.thread]?.turns.at(-1);
  if (record) { record.items.push({ type: 'agentMessage', text }); record.status = 'completed'; persist(); }
  const p = { threadId: current.thread, turnId: current.turn, itemId: current.item };
  notify('item/agentMessage/delta', { ...p, delta: text.slice(0, Math.floor(text.length / 2)) });
  notify('item/agentMessage/delta', { ...p, delta: text.slice(Math.floor(text.length / 2)) });
  notify('item/completed', { ...p, item: { id: p.itemId, type: 'agentMessage', text } });
  notify('turn/completed', { threadId: current.thread, turn: { id: current.turn, status: 'completed' } });
  current = null;
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line);
  if (!msg.method) {
    if (waiting === msg.id) { waiting = null; finish('確認への返答を受け取りました。'); }
    return;
  }
  let result;
  if (msg.method === 'initialize') result = { userAgent: 'fixture' };
  else if (msg.method === 'initialized') return;
  else if (msg.method === 'account/read') result = { account: { type: 'chatgpt' }, requiresOpenaiAuth: true };
  else if (msg.method === 'account/rateLimits/read') {
    if (stateFile && fs.existsSync(stateFile)) saved.usage = JSON.parse(fs.readFileSync(stateFile, 'utf8')).usage;
    if (saved.usage?.fixtureError) return send({ id: msg.id, error: { code: -32601, message: 'Fixture unavailable' } });
    result = saved.usage || { ordinaryUsageAllowed: true, rateLimits: { limitId: 'codex', primary: { usedPercent: 10, resetsAt: Math.floor(Date.now() / 1000) + 3600 } } };
  }
  else if (msg.method === 'model/list') result = msg.params.cursor
    ? { data: [{ model: 'fixture-simple', id: 'simple-id', displayName: 'Fixture Simple', defaultReasoningEffort: '', supportedReasoningEfforts: [] }], nextCursor: null }
    : { data: [{ model: 'fixture-fast', id: 'fast-id', displayName: 'Fixture Fast', isDefault: true, defaultReasoningEffort: 'low',
      supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }], nextCursor: 'second' };
  else if (msg.method === 'thread/start') {
    const id = 'thread-' + ++thread;
    saved.threads[id] = { id, cwd: msg.params.cwd, turns: [], ephemeral: msg.params.ephemeral === true, status: { type: 'idle' } }; persist();
    result = { thread: saved.threads[id], cwd: msg.params.cwd, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: { type: 'readOnly', networkAccess: false } };
  } else if (msg.method === 'thread/read') {
    const mode = stateFile && fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')).recoveryRead : undefined;
    if (mode === 'error') return send({ id: msg.id, error: { code: -32601, message: 'Fixture state unavailable' } });
    const record = saved.threads[msg.params.threadId];
    if (!record) return send({ id: msg.id, error: { code: -32600, message: 'Missing fixture thread' } });
    result = { thread: { id: mode === 'wrong' ? 'other-thread' : record.id, cwd: mode === 'cwd' ? record.cwd + '-other' : record.cwd, ephemeral: record.ephemeral, status: { type: ['active','notLoaded','systemError'].includes(mode) ? mode : 'idle' }, turns: [] } };
    if (mode === 'slow') { setTimeout(() => send({ id: msg.id, result }), 1500); return; }
  } else if (msg.method === 'thread/resume') {
    const record = saved.threads[msg.params.threadId];
    if (!record) return send({ id: msg.id, error: { code: -32600, message: 'missing fixture thread' } });
    result = { thread: { ...record, turns: [] }, cwd: record.cwd, approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: { type: 'dangerFullAccess' } };
  } else if (msg.method === 'thread/turns/list') {
    if (stateFile && fs.existsSync(stateFile)) saved.historyMode = JSON.parse(fs.readFileSync(stateFile, 'utf8')).historyMode;
    if (saved.historyMode === 'oversized') { process.stdout.write(JSON.stringify({ id: msg.id, result: { padding: 'x'.repeat(8 * 1024 * 1024) } }) + '\n'); return; }
    if (saved.historyMode === 'unavailable') return send({ id: msg.id, error: { code: -32601, message: 'Fixture history unavailable' } });
    const turns = saved.threads[msg.params.threadId]?.turns || [], offset = Number(msg.params.cursor || 0);
    const data = [...turns].reverse().slice(offset, offset + msg.params.limit);
    result = { data: msg.params.itemsView === 'notLoaded' ? data.map(turn => ({ ...turn, items: [] })) : data, nextCursor: offset + msg.params.limit < turns.length ? String(offset + msg.params.limit) : null };
  } else if (msg.method === 'thread/items/list') {
    if (saved.historyMode === 'legacy') return send({ id: msg.id, error: { code: -32601, message: 'Fixture items unsupported' } });
    const record = saved.threads[msg.params.threadId]?.turns.find(turn => turn.id === msg.params.turnId);
    const items = [...(record?.items || [])].reverse(), offset = Number(msg.params.cursor || 0);
    result = { data: items.slice(offset, offset + msg.params.limit).map(item => ({ turnId: record.id, item })), nextCursor: offset + msg.params.limit < items.length ? String(offset + msg.params.limit) : null };
  } else if (msg.method === 'thread/compact/start') {
    if (stateFile && fs.existsSync(stateFile)) saved.compactMode = JSON.parse(fs.readFileSync(stateFile, 'utf8')).compactMode;
    if (saved.compactMode === 'unsupported') return send({ id: msg.id, error: { code: -32601, message: 'Fixture unsupported compaction' } });
    current = { thread: msg.params.threadId, turn: 'compact-' + ++turn, item: 'compact-item-' + turn, compact: true };
    saved.threads[current.thread].turns.push({ id: current.turn, status: 'inProgress', items: [{ type: 'contextCompaction', id: current.item }] }); persist();
    send({ id: msg.id, result: {} });
    if (saved.compactMode === 'ackOnly') return;
    notify('turn/started', { threadId: current.thread, turn: { id: current.turn, status: 'inProgress' } });
    notify('item/started', { threadId: current.thread, turnId: current.turn, item: { type: 'contextCompaction', id: current.item } });
    if (saved.compactMode === 'hold') return;
    if (saved.compactMode === 'quota') {
      saved.usage = { ordinaryUsageAllowed: false, rateLimits: { primary: { usedPercent: 100, resetsAt: null } } }; persist();
      timer = setTimeout(() => failTurn('usageLimitExceeded'), 30);
    } else if (saved.compactMode === 'fail') timer = setTimeout(() => failTurn('internalServerError'), 30);
    else timer = setTimeout(() => finishCompact(saved.compactMode !== 'incomplete'), saved.compactMode === 'slow' ? 1500 : 30);
    return;
  } else if (msg.method === 'fixture/completeCompact') {
    finishCompact(); result = {};
  }
  else if (msg.method === 'turn/start') {
    const text = msg.params.input[0].text;
    if (text.includes('RPC利用制限')) {
      send({ id: msg.id, error: { code: -32600, message: 'Untrusted raw fixture message', data: { codexErrorInfo: 'usageLimitExceeded', apiKey: 'fixture-limit-secret' } } }); return;
    }
    if (text.includes('RPCコンテキスト制限')) {
      send({ id: msg.id, error: { code: -32600, message: 'Fixture context failure', data: { codexErrorInfo: 'contextWindowExceeded' } } }); return;
    }
    if (text.includes('制限拒否') && msg.params.approvalPolicy === 'never') {
      send({ id: msg.id, error: { code: -32602, message: 'Fixture policy does not allow this mode.' } }); return;
    }
    current = { thread: msg.params.threadId, turn: 'turn-' + ++turn, item: 'item-' + turn };
    saved.threads[current.thread]?.turns.push({ id: current.turn, status: 'inProgress', items: [{ type: 'userMessage', content: [{ type: 'text', text }] }] }); persist();
    send({ id: msg.id, result: { turn: { id: current.turn, status: 'inProgress' } } });
    notify('turn/started', { threadId: current.thread, turn: { id: current.turn, status: 'inProgress' } });
    if (text.includes('切断再開テスト')) timer = setTimeout(() => process.exit(0), 30);
    else if (text.includes('コンテキスト制限')) timer = setTimeout(() => failTurn('contextWindowExceeded'), 30);
    else if (text.includes('利用枠制限') || text.includes('一時制限')) {
      saved.usage = { ordinaryUsageAllowed: false, rateLimits: { limitId: 'codex', rateLimitReachedType: 'rate_limit_reached',
        primary: { usedPercent: 100, resetsAt: text.includes('時刻不明') ? null : Math.floor(Date.now() / 1000) + 3600, windowDurationMins: 300 } } }; persist();
      timer = setTimeout(() => failTurn(text.includes('一時制限') ? { httpConnectionFailed: { httpStatusCode: 429 } } : 'usageLimitExceeded', !text.includes('終了情報なし')), 30);
    } else if (text.includes('再試行から回復')) {
      notify('error', { threadId: current.thread, turnId: current.turn, error: { codexErrorInfo: 'rateLimitExceeded' }, willRetry: true });
      timer = setTimeout(() => finish('再試行して回復しました。'), 30);
    } else if (text.includes('通常の失敗')) timer = setTimeout(() => failTurn('internalServerError'), 30);
    else if (text.includes('表示省略テスト')) timer = setTimeout(() => finish('VISIBLE_REPLY_START\n' + '文'.repeat(1024 * 1024 + 512) + '\nHIDDEN_REPLY_TAIL'), 30);
    else if (text.includes('ログ大量')) {
      for (let n = 0; n < 230; n++) {
        const item = { id: 'storm-' + turn + '-' + n, type: 'mcpToolCall', server: 'fixture', tool: 'log-storm-' + n, arguments: { n }, status: 'inProgress' };
        notify('item/started', { threadId: current.thread, turnId: current.turn, item });
        notify('item/completed', { threadId: current.thread, turnId: current.turn, item: { ...item, status: 'completed' } });
      }
      timer = setTimeout(() => finish('応答: ' + text), 30);
    } else if (text.includes('ツール詳細')) {
      const tool = { id: 'tool-' + turn, type: 'mcpToolCall', server: 'fixture', tool: 'diagnostic', status: 'inProgress', arguments: { password: 'fixture-password' } };
      notify('item/started', { threadId: current.thread, turnId: current.turn, item: tool });
      notify('item/completed', { threadId: current.thread, turnId: current.turn, item: { ...tool, status: 'completed', result: { content: [
        { type: 'text', text: '{"apiKey":"fixture-tool-secret"}' }, { type: 'text', text: '<script>window.fixtureExecuted=true</script>' },
      ] } } });
      timer = setTimeout(() => finish('応答: ' + text + ' [' + msg.params.model + '/' + msg.params.effort + ']'), 30);
    } else if (text.includes('MCP確認')) {
      waiting = 900 + turn;
      send({ id: waiting, method: 'mcpServer/elicitation/request', params: { threadId: current.thread, turnId: current.turn,
        mode: 'form', message: 'MCPの操作を許可しますか？', requestedSchema: { type: 'object', properties: {} } } });
    } else if (text.includes('承認')) {
      waiting = 900 + turn;
      send({ id: waiting, method: 'item/commandExecution/requestApproval', params: { threadId: current.thread, turnId: current.turn, reason: 'Fixtureの確認です。', availableDecisions: ['accept', 'decline', 'cancel'] } });
    } else if (text.includes('質問')) {
      waiting = 900 + turn;
      send({ id: waiting, method: 'item/tool/requestUserInput', params: { threadId: current.thread, turnId: current.turn,
        questions: [{ id: 'choice', question: '表示する内容を選んでください。', options: [{ label: '短く' }, { label: '詳しく' }] }] } });
    } else if (text.includes('遅延')) timer = setTimeout(() => finish('遅延の応答'), 30000);
    else timer = setTimeout(() => finish(text.includes('長文') ? '文'.repeat(10000) : '応答: ' + text + ' [' + msg.params.model + '/' + (msg.params.effort || '指定なし') + ']'), 30);
    return;
  } else if (msg.method === 'turn/interrupt') {
    saved.interruptions = (saved.interruptions || 0) + 1;
    clearTimeout(timer);
    const record = saved.threads[current?.thread]?.turns.at(-1);
    if (record) { record.status = 'interrupted'; persist(); }
    if (current) notify('turn/completed', { threadId: current.thread, turn: { id: current.turn, status: 'interrupted' } });
    current = null; result = {};
  } else return send({ id: msg.id, error: { code: -32601, message: 'Unknown method' } });
  send({ id: msg.id, result });
});
process.stdin.on('end', () => { clearTimeout(timer); process.exit(0); });
