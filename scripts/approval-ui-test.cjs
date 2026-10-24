'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { resolveCodex } = require('../src/codex-process.cjs');
const root = path.resolve(__dirname, '..'), host = path.resolve(root, '../AppDock.at365');
const { launch, until, hash } = require(path.join(host, 'scripts/page-test-host.cjs'));
const profile = path.join(root, '.artifacts', 'approval-ui-' + Date.now());
const folder = path.join(profile, 'extensions', 'ChatCodex');
fs.mkdirSync(folder, { recursive: true });
fs.cpSync(process.env.CHATCODEX_TEST_PACKAGE || path.join(root, 'out/Applet.ChatCodex.at365'), folder, { recursive: true });
const native = resolveCodex().file;
const node = path.join(host, '.tools', 'node', require(path.join(host, 'toolchain.json')).node, 'node.exe');
const overrides = [
  'approval_policy="on-request"', 'approvals_reviewer="user"', 'sandbox_mode="read-only"',
  'mcp_servers.chatcodex_approval_fixture.command=' + JSON.stringify(node),
  'mcp_servers.chatcodex_approval_fixture.args=' + JSON.stringify([path.join(root, 'tests/fixtures/mcp-approval.cjs')]),
];
const command = { file: native, args: overrides.flatMap(value => ['-c', value]) };
const policiesFile = path.join(profile, 'policies.jsonl');
const eventsFile = path.join(profile, 'events.jsonl');
const manifest = require('../extension.json');
fs.writeFileSync(path.join(folder, 'extension.json'), JSON.stringify({ ...manifest, entry: 'diagnostic-entry.cjs' }));
fs.writeFileSync(path.join(folder, 'diagnostic-entry.cjs'),
  "const fs=require('node:fs');const {createApplet}=require('./src/applet.cjs');const {CodexProcess}=require('./src/codex-process.cjs');" +
  'module.exports=createApplet({clientFactory:()=>{const c=new CodexProcess({command:' + JSON.stringify(command) + ',env:{...process.env,LOCALAPPDATA:' + JSON.stringify(process.env.LOCALAPPDATA) + '}});' +
  'const record=value=>fs.appendFileSync(' + JSON.stringify(eventsFile) + ",JSON.stringify(value)+'\\n');" +
  "c.on('request',m=>record({method:m.method,mode:m.params?.mode,fields:Object.keys(m.params?.requestedSchema?.properties||{})}));" +
  "c.on('notification',m=>{if(m.method==='item/completed'&&m.params?.item?.type==='mcpToolCall')record({method:m.method,server:m.params.item.server,tool:m.params.item.tool,status:m.params.item.status,error:m.params.item.error});});" +
  'const request=c.request.bind(c);let checked=false;c.request=async(method,params,...rest)=>{' +
  "if(method==='turn/start'&&!checked){checked=true;const answer=await request('mcpServer/tool/call',{threadId:params.threadId,server:'chatcodex_approval_fixture',tool:'ask_consent',arguments:{}},60000);record({method:'diagnosticMcp',accepted:JSON.stringify(answer).includes('CONSENT_ACCEPTED')});}" +
  'const result=await request(method,params,...rest);if(method===\'thread/start\'||method===\'turn/start\')fs.appendFileSync(' + JSON.stringify(policiesFile) +
  ",JSON.stringify(method==='thread/start'?{method,approvalPolicy:result.approvalPolicy,approvalsReviewer:result.approvalsReviewer,sandboxPolicy:result.sandbox}:{method,approvalPolicy:params.approvalPolicy,approvalsReviewer:params.approvalsReviewer,sandboxPolicy:params.sandboxPolicy})+'\\n');return result;};return c;}});");
const settings = require(path.join(host, 'out/main/shared/settings-schema')).createDefaultSettings();
settings.host.hardwareAcceleration = false; settings.host.closeToTray = false; settings.host.soundEnabled = false;
settings.globalShortcutCommands = []; settings.gestures.enabled = false;
settings.updates.checkHostOnStartup = false; settings.updates.checkAppletsOnStartup = false;
settings.extensions = { 'at365.chatcodex': { enabled: true, settings: {} } };
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings));
let instance, page;
(async () => {
  try {
    instance = await launch(profile, path.resolve(root, '../../40.ARTIFACT/AppDock.at365/AppDock.at365.exe'));
    await until(async () => (await instance.main.evaluate(() => window.dock.snapshot())).extensions.find(e => e.id === 'at365.chatcodex')?.state === 'running', 'approval Applet running');
    await instance.main.evaluate(() => window.dock.executeCommand('at365.chatcodex.open'));
    page = await instance.page('/ChatCodex/web/index.html');
    await until(async () => (await page.getByTestId('status').textContent()).startsWith('接続済み'), 'Codex connected', 60000);
    if (await page.getByTestId('effort').locator('option[value="low"]').count()) {
      await page.getByTestId('effort').selectOption('low'); await until(() => page.getByTestId('effort').isEnabled(), 'effort saved');
    }
    for (const mode of ['ask', 'auto', 'full', 'inherit']) {
      await page.getByTestId('approval').click(); await page.locator('[data-mode="' + mode + '"]').click();
      await until(() => page.getByTestId('approval').isEnabled(), 'mode saved');
      const text = '疎通確認です。MCP・ファイル・コマンド・音声を使わず、「MODE_' + mode + '_OK」とだけ返してください。';
      await page.getByTestId('input').fill(text); await page.getByTestId('input').press('Enter');
      if (mode === 'ask') {
        await until(async () => (await page.getByTestId('requests').textContent()).includes('疎通確認用のMCP承認'), 'real MCP approval card', 90000);
        await page.screenshot({ path: path.join(profile, 'real-mcp-approval.png') });
        await page.locator('[data-choice="accept"]').click();
      }
      await until(async () => {
        const reply = (await page.locator('.message[data-role="assistant"] .message-text').allTextContents()).join('');
        const status = await page.getByTestId('status').textContent();
        if (status.includes('受け付けません') || status.includes('承認設定を確認できません')) throw Error(status);
        return reply.includes('MODE_' + mode + '_OK') && status.startsWith('接続済み');
      }, 'mode ' + mode + ' completed', 90000);
    }
    const policies = fs.readFileSync(policiesFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const baseline = policies.find(p => p.method === 'thread/start'), turns = policies.filter(p => p.method === 'turn/start');
    const events = fs.readFileSync(eventsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(events.some(event => event.method === 'diagnosticMcp' && event.accepted));
    assert.equal(baseline.approvalPolicy, 'on-request'); assert.equal(baseline.approvalsReviewer, 'user'); assert.equal(baseline.sandboxPolicy.type, 'readOnly');
    assert.deepEqual(turns.map(p => [p.approvalPolicy, p.approvalsReviewer, p.sandboxPolicy.type]), [
      ['on-request', 'user', 'workspaceWrite'], ['on-request', 'auto_review', 'workspaceWrite'], ['never', 'user', 'dangerFullAccess'], ['on-request', 'user', 'readOnly'],
    ]);
    const result = { ok: true, fixture: 'diagnostic MCP server called via native mcpServer/tool/call; real Codex and Applet UI', appletVersion: manifest.version,
      codexVersion: execFileSync(native, ['--version'], { encoding: 'utf8', windowsHide: true }).trim(),
      hostSha256: instance.hash, codexSha256: hash(native), strictConfigOverrides: true, realMcpApprovalAnswered: true, fourModesAccepted: true, inheritedReadOnlyRestored: true, policies };
    await instance.close(); instance = null;
    fs.writeFileSync(path.join(profile, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ ...result, profile }));
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(profile, 'failure.png') });
      const diagnostic = { ok: false, error: error.message, status: await page.getByTestId('status').textContent(),
        requests: await page.getByTestId('requests').textContent(), assistant: await page.locator('.message[data-role="assistant"] .message-text').allTextContents() };
      fs.writeFileSync(path.join(profile, 'failure.json'), JSON.stringify(diagnostic, null, 2));
      console.log(JSON.stringify({ failure: diagnostic, profile }));
    }
    throw error;
  } finally { await instance?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
