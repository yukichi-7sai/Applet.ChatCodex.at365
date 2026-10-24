'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { resolveCodex } = require('../src/codex-process.cjs');
const root = path.resolve(__dirname, '..'), host = path.resolve(root, '../AppDock.at365');
const { launch, until, hash } = require(path.join(host, 'scripts/page-test-host.cjs'));
const profile = path.join(root, '.artifacts', 'real-ui-' + Date.now());
const folder = path.join(profile, 'extensions', 'ChatCodex'), bin = path.join(profile, 'bin');
fs.mkdirSync(folder, { recursive: true }); fs.mkdirSync(bin, { recursive: true });
fs.cpSync(path.join(root, 'out/Applet.ChatCodex.at365'), folder, { recursive: true });
const source = resolveCodex().file, executable = path.join(bin, 'codex.exe');
fs.copyFileSync(source, executable);
assert.equal(hash(source), hash(executable));
const manifest = require('../extension.json');
fs.writeFileSync(path.join(folder, 'extension.json'), JSON.stringify({ ...manifest, entry: 'ephemeral-entry.cjs' }));
fs.writeFileSync(path.join(folder, 'ephemeral-entry.cjs'),
  "const {createApplet}=require('./src/applet.cjs');const {CodexProcess}=require('./src/codex-process.cjs');" +
  "module.exports=createApplet({clientFactory:()=>{const c=new CodexProcess();const request=c.request.bind(c);c.request=async(method,params,...rest)=>{" +
  "const result=await request(method,method==='thread/start'?{...params,ephemeral:true}:params,...rest);" +
  "if(method==='thread/start'&&(result.thread?.ephemeral!==true||result.thread.path))throw Error('Test thread must not persist');return result;};return c;}});");
const settings = require(path.join(host, 'out/main/shared/settings-schema')).createDefaultSettings();
settings.host.hardwareAcceleration = false; settings.host.closeToTray = false; settings.host.soundEnabled = false;
settings.globalShortcutCommands = []; settings.gestures.enabled = false;
settings.updates.checkHostOnStartup = false; settings.updates.checkAppletsOnStartup = false;
settings.extensions = { 'at365.chatcodex': { enabled: true, settings: {} } };
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings));
let instance;
(async () => {
  try {
    instance = await launch(profile, path.resolve(root, '../../40.ARTIFACT/AppDock.at365/AppDock.at365.exe'), { PATH: bin + path.delimiter + process.env.PATH });
    await until(async () => (await instance.main.evaluate(() => window.dock.snapshot())).extensions.find(e => e.id === 'at365.chatcodex')?.state === 'running', 'real Applet running');
    await instance.main.evaluate(() => window.dock.executeCommand('at365.chatcodex.open'));
    const page = await instance.page('/ChatCodex/web/index.html');
    await until(async () => {
      const status = await page.getByTestId('status').textContent();
      if (status.startsWith('接続を確認')) throw Error(status);
      return status.startsWith('接続済み');
    }, 'real Codex connected', 60000);
    const options = await page.getByTestId('model').locator('option').count();
    assert.ok(options > 1);
    const effort = await page.getByTestId('effort').locator('option[value="low"]').count();
    if (effort) { await page.getByTestId('effort').selectOption('low'); await until(() => page.getByTestId('effort').isEnabled(), 'effort saved'); }
    await page.getByTestId('input').fill('接続確認です。MCP、ファイル、コマンド、音声は使わず、「接続確認完了」とだけ返してください。');
    await page.getByTestId('input').press('Control+Enter');
    await until(async () => {
      const text = await page.locator('.message[data-role="assistant"] .message-text').allTextContents();
      return text.join('').includes('接続確認完了') && (await page.getByTestId('status').textContent()).startsWith('接続済み');
    }, 'real response in real UI', 90000);
    const result = { ok: true, fixture: false, appletVersion: require('../extension.json').version, codexVersion: execFileSync(source, ['--version'], { encoding: 'utf8', windowsHide: true }).trim(),
      executableSha256: hash(source), hostSha256: instance.hash, modelOptions: options - 1, realResponseDisplayed: true };
    await instance.close(); instance = null;
    fs.writeFileSync(path.join(profile, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, profile }));
  } finally { await instance?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
