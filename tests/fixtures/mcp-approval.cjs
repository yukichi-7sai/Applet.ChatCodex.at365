'use strict';
// Diagnostic MCP tool: requests consent and returns its answer; it changes no settings or files.
const readline = require('node:readline');
let pending, sequence = 0;
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line);
  if (pending && msg.id === pending.id && !msg.method) {
    send({ id: pending.callId, result: { content: [{ type: 'text', text: msg.result?.action === 'accept' ? 'CONSENT_ACCEPTED' : 'CONSENT_CANCELED' }] } });
    pending = null; return;
  }
  if (msg.id === undefined) return;
  if (msg.method === 'initialize') send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, serverInfo: { name: 'chatcodex-approval-fixture', version: '1.0.0' }, capabilities: { tools: {} } } });
  else if (msg.method === 'tools/list') send({ id: msg.id, result: { tools: [{ name: 'ask_consent', description: 'Requests a diagnostic confirmation only. Does not change files, settings, or external state.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }] } });
  else if (msg.method === 'tools/call' && msg.params.name === 'ask_consent' && !pending) {
    pending = { id: 'consent-' + ++sequence, callId: msg.id };
    send({ id: pending.id, method: 'elicitation/create', params: { mode: 'form', message: '疎通確認用のMCP承認です。設定やファイルは変更しません。', requestedSchema: { type: 'object', properties: {} } } });
  } else if (msg.method === 'ping') send({ id: msg.id, result: {} });
  else send({ id: msg.id, error: { code: -32601, message: 'Unsupported diagnostic request.' } });
});
process.stdin.on('end', () => process.exit(0));
