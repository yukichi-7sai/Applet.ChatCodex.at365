'use strict';
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const { CodexProcess } = require('../src/codex-process.cjs');
const root = path.resolve(__dirname, '..');
if (process.argv.includes('--child')) {
  const client = new CodexProcess();
  client.start().then(() => { process.stdout.write(JSON.stringify({ pid: client.child.pid }) + '\n', () => process.exit(0)); })
    .catch(() => process.exit(1));
} else {
  (async () => {
    let target;
    const child = spawn(process.execPath, [__filename, '--child'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let data = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { data += chunk; });
    child.stderr.resume();
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error('probe child failed'))); });
    target = JSON.parse(data.trim()).pid;
    let exited = false;
    for (let count = 0; count < 50; count++) {
      try { process.kill(target, 0); } catch { exited = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    // target is exclusively the child created above; no process-name cleanup is used.
    if (!exited) { try { process.kill(target); } catch {} }
    const result = { ok: exited, fixture: false, parentExitedWithoutCleanup: true, appServerExitedAfterPipeLoss: exited, codexVersion: '0.161.0' };
    const folder = path.join(root, '.artifacts', 'lifecycle-' + Date.now());
    fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, folder }));
    if (!exited) process.exitCode = 1;
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
