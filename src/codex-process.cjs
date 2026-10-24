'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

function resolveCodex(env = process.env, platform = process.platform) {
  const exists = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };
  const paths = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  if (env.LOCALAPPDATA) paths.push(path.join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin'));
  const expand = (value, dir) => value.replace(/%~dp0/gi, dir + path.sep)
    .replace(/%([a-zA-Z_][a-zA-Z0-9_]*)%/g, (_, name) => {
      const key = Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase());
      return key ? env[key] : '%' + name + '%';
    });
  for (const dir of paths) {
    const direct = path.join(dir.replace(/^"|"$/g, ''), platform === 'win32' ? 'codex.exe' : 'codex');
    if (exists(direct)) return { file: direct, args: [] };
    if (platform !== 'win32') continue;
    const shim = path.join(dir, 'codex.cmd');
    if (!exists(shim)) continue;
    let source;
    try { if (fs.statSync(shim).size > 32768) continue; source = fs.readFileSync(shim, 'utf8'); } catch { continue; }
    // Only a literal executable followed by the standard argument placeholder is accepted.
    const lines = source.split(/\r?\n/).map(line => line.trim()).filter(line => line && !/^@?echo off$/i.test(line));
    if (lines.length === 1) {
      const match = /^@?"([^"]+\.exe)"\s+%\*$/i.exec(lines[0]);
      if (match) {
        const target = expand(match[1], path.dirname(shim));
        if (!target.includes('%') && path.isAbsolute(target) && exists(target)) return { file: target, args: [] };
      }
    }
    if (source.includes('@openai') && /codex[\\/]bin[\\/]codex\.js/.test(source)) {
      const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
      const packageName = process.arch === 'arm64' ? 'codex-win32-arm64' : 'codex-win32-x64';
      for (const base of [
        path.join(dir, 'node_modules', '@openai', 'codex'),
        path.join(dir, 'node_modules', '@openai', packageName),
        path.join(dir, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', packageName),
      ]) {
        const target = path.join(base, 'vendor', triple, 'codex', 'codex.exe');
        if (exists(target)) return { file: target, args: [] };
      }
    }
  }
  throw Error('Codex実行プログラムが見つかりません。通常のターミナルで codex --version を確認してください。');
}

class CodexProcess extends EventEmitter {
  constructor({ command, env = process.env, cwd = process.cwd(), requestTimeout = 60000 } = {}) {
    super();
    this.command = command;
    this.env = { ...env };
    delete this.env.ELECTRON_RUN_AS_NODE;
    this.cwd = cwd;
    this.requestTimeout = requestTimeout;
    this.pending = new Map();
    this.incoming = new Map();
    this.sequence = 0;
    this.closed = false;
    this.intentional = false;
    this.buffer = '';
  }
  async start() {
    if (this.child) throw Error('Codexは起動済みです。');
    const command = this.command || resolveCodex(this.env);
    this.child = spawn(command.file, [...command.args, 'app-server', '--listen', 'stdio://'], {
      cwd: this.cwd, env: this.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
    });
    const child = this.child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this.consume(chunk));
    child.stdout.on('error', () => this.fail('Codexからの受信に失敗しました。'));
    child.stdin.on('error', () => this.fail('Codexへの送信に失敗しました。'));
    child.stderr.resume();
    child.once('error', () => this.fail('Codexを起動できませんでした。実行ファイルを確認してください。'));
    child.once('exit', () => this.fail('Codexとの接続が終了しました。処理中の場合は結果を確認してください。'));
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', () => reject(Error('Codexを起動できませんでした。')));
    });
    await this.request('initialize', {
      clientInfo: { name: 'appdock_chatcodex', title: 'AppDock ChatCodex', version: require('../extension.json').version },
      capabilities: { experimentalApi: false },
    });
    this.send({ method: 'initialized', params: {} });
  }
  consume(chunk) {
    if (this.closed) return;
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 8 * 1024 * 1024) return this.fail('Codexの応答が大きすぎます。');
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { return this.fail('Codexの応答形式が不正です。'); }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return this.fail('Codexの応答形式が不正です。');
      if (typeof msg.method === 'string' && msg.id !== undefined) {
        if (this.incoming.size >= 32) return this.fail('Codexからの確認要求が多すぎます。');
        this.incoming.set(msg.id, msg.method);
      }
      if (msg.method === 'serverRequest/resolved') this.incoming.delete(msg.params?.requestId);
      this.emit('wire', { direction: '受信', method: msg.method || this.pending.get(msg.id)?.method, message: msg });
      if (typeof msg.method === 'string') this.emit(msg.id === undefined ? 'notification' : 'request', msg);
      else if (msg.id !== undefined) {
        const pending = this.pending.get(msg.id);
        if (!pending) continue;
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.error) {
          const error = Error('Codexの要求に失敗しました（' + pending.method + '）。');
          error.code = msg.error.code;
          pending.reject(error);
        } else pending.resolve(msg.result);
      }
    }
  }
  send(message, method = message.method) {
    if (this.closed || !this.child?.stdin.writable) throw Error('Codexに接続されていません。');
    const line = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(line) > 1024 * 1024) throw Error('Codexへの要求が大きすぎます。');
    this.child.stdin.write(line);
    this.emit('wire', { direction: '送信', method, message });
  }
  request(method, params, timeout = this.requestTimeout) {
    if (this.pending.size >= 32) return Promise.reject(Error('Codexへの要求が混み合っています。'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = Error('Codexの応答を待つ時間を超えました（' + method + '）。');
        error.uncertain = true;
        reject(error);
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.send({ id, method, params }); } catch (error) {
        clearTimeout(timer); this.pending.delete(id); reject(error);
      }
    });
  }
  respond(id, result) { this.send({ id, result }, this.incoming.get(id)); this.incoming.delete(id); }
  unsupported(id) { this.send({ id, error: { code: -32601, message: 'This client does not support this request.' } }, this.incoming.get(id)); this.incoming.delete(id); }
  fail(message, kill = true) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Error(message)); }
    this.pending.clear();
    this.buffer = '';
    if (!this.intentional) this.emit('closed', message);
    if (kill && this.child && this.child.exitCode === null) this.child.kill();
  }
  async close() {
    this.intentional = true;
    const child = this.child;
    this.fail('Codexとの接続を終了しました。', false);
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.stdin.end();
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 1000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}
module.exports = { resolveCodex, CodexProcess };
