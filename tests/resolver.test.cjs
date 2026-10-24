'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const test = require('node:test'), assert = require('node:assert/strict');
const { resolveCodex, CodexProcess } = require('../src/codex-process.cjs');
function workspace(t) {
  const base = path.resolve(__dirname, '..', '.artifacts', 'resolver');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'case-'));
  t.after(() => {
    if (!path.resolve(dir).startsWith(base + path.sep)) throw Error('Unsafe test cleanup');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
test('実体の.exeを直接解決し、shellを使わない', t => {
  const dir = workspace(t); fs.writeFileSync(path.join(dir, 'codex.exe'), '');
  assert.equal(resolveCodex({ PATH: dir }, 'win32').file, path.join(dir, 'codex.exe'));
});
test('WinGet型shimの環境変数を安全に解決', t => {
  const dir = workspace(t); fs.writeFileSync(path.join(dir, 'native.exe'), '');
  fs.writeFileSync(path.join(dir, 'codex.cmd'), '@echo off\r\n"%LOCALAPPDATA%\\native.exe" %*\r\n');
  assert.equal(resolveCodex({ PATH: dir, LOCALAPPDATA: dir }, 'win32').file, path.join(dir, 'native.exe'));
});
test('任意コマンドのあるshim、参照先不在は実行しない', t => {
  const dir = workspace(t);
  fs.writeFileSync(path.join(dir, 'codex.cmd'), '@echo off\n"missing.exe" %*\necho unsafe\n');
  assert.throws(() => resolveCodex({ PATH: dir }, 'win32'));
});
test('Node Applet由来のElectronフラグを子へ引き継がない', () => {
  const client = new CodexProcess({ env: { ELECTRON_RUN_AS_NODE: '1', PATH: 'fixture' } });
  assert.equal(client.env.ELECTRON_RUN_AS_NODE, undefined);
});
test('壊れたJSONと巨大な受信は接続を閉じる', () => {
  const a = new CodexProcess(); a.consume('not-json\n'); assert.equal(a.closed, true);
  const b = new CodexProcess(); b.consume('x'.repeat(8 * 1024 * 1024 + 1)); assert.equal(b.closed, true);
});
