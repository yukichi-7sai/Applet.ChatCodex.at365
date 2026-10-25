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

const frameLimit = 8 * 1024 * 1024;
function frameOfBytes(bytes, tail = '') {
  const prefix = '{"method":"fixture/data","params":{"text":"', suffix = '"}}';
  return prefix + 'x'.repeat(bytes - Buffer.byteLength(prefix + tail + suffix)) + tail + suffix;
}
test('短いJSON行が同時に8MiBを超えて届いても、行ごとに受信を続ける', () => {
  const client = new CodexProcess(); let received = 0;
  client.on('notification', () => received++);
  const line = frameOfBytes(1024 * 1024) + '\n';
  client.consume(line.repeat(9));
  assert.equal(client.closed, false); assert.equal(received, 9); assert.equal(client.buffer, '');
});
test('1行8MiBちょうどと隣の行を、分割chunkでも切断せず処理する', () => {
  const client = new CodexProcess(); let received = 0;
  client.on('notification', () => received++);
  const exact = frameOfBytes(frameLimit, '文');
  const small = '{"method":"fixture/next","params":{}}\n';
  assert.equal(Buffer.byteLength(exact), frameLimit);
  client.consume(exact.slice(0, 100)); client.consume(exact.slice(100));
  assert.equal(client.closed, false); assert.equal(received, 0);
  client.consume('\n' + small + small.slice(0, 10));
  assert.equal(client.closed, false); assert.equal(received, 2);
  client.consume(small.slice(10));
  assert.equal(client.closed, false); assert.equal(received, 3); assert.equal(client.buffer, '');
});
test('同じchunkに小さい行が先行していても、上限超過の単一行で停止し再送しない', () => {
  const client = new CodexProcess(); let received = 0, sent = 0, closed = 0;
  client.on('notification', () => received++); client.on('closed', () => closed++); client.send = () => sent++;
  const small = '{"method":"fixture/next","params":{}}\n', oversized = frameOfBytes(frameLimit + 1, '文');
  assert.ok(oversized.length <= frameLimit);
  client.consume(small + oversized + '\n' + small);
  assert.equal(client.closed, true); assert.equal(received, 1); assert.equal(sent, 0); assert.equal(closed, 1);
  client.consume(small); assert.equal(received, 1); assert.equal(sent, 0);
});
test('改行前のJSON行も分割受信の合計バイトが上限を超えた時点で停止する', () => {
  const client = new CodexProcess(); let sent = 0;
  client.send = () => sent++;
  const oversized = frameOfBytes(frameLimit + 1, '文');
  client.consume(oversized.slice(0, 100)); client.consume(oversized.slice(100, -3));
  assert.equal(client.closed, false);
  client.consume(oversized.slice(-3));
  assert.equal(client.closed, true); assert.equal(sent, 0);
});
