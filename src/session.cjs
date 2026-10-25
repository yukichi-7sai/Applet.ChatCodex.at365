'use strict';
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { threadDefaults } = require('./approval-modes.cjs');
const { validPause } = require('./usage.cjs');
const { validRecovery } = require('./context-recovery.cjs');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function scopeFor(env = process.env) {
  const key = Object.keys(env).find(key => key.toUpperCase() === 'CODEX_HOME');
  const home = path.resolve(env[key] || path.join(os.homedir(), '.codex'));
  return createHash('sha256').update(process.platform === 'win32' ? home.toLowerCase() : home).digest('hex');
}
function validateSession(value) {
  if (value == null) return null;
  if (!object(value) || Buffer.byteLength(JSON.stringify(value)) > 32768 || value.schemaVersion !== 1 ||
      typeof value.threadId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value.threadId) ||
      typeof value.cwd !== 'string' || !path.isAbsolute(value.cwd) || value.cwd.length > 8192 ||
      typeof value.scope !== 'string' || !/^[a-f0-9]{64}$/.test(value.scope) ||
      typeof value.inFlight !== 'boolean' || !object(value.options) ||
      typeof value.options.sendOperationInstructions !== 'boolean' || !['inherit', 'include', 'exclude'].includes(value.options.memoryMode) ||
      !object(value.defaults)) throw Error('保存した会話の情報に対応していません。「新しいチャット」で開始し直せます。');
  threadDefaults({ ...value.defaults, sandbox: value.defaults.sandboxPolicy });
  if (value.pause != null && !validPause(value.pause)) throw Error('保存した停止情報に対応していません。');
  if (value.contextRecovery != null && !validRecovery(value.contextRecovery)) throw Error('保存した会話の復旧情報に対応していません。');
  return structuredClone(value);
}
class SessionStore {
  constructor(storage) { this.storage = storage; this.pending = Promise.resolve(); }
  async load() {
    await this.pending.catch(() => {});
    try { return validateSession(await this.storage.get('lastSession')); }
    catch { throw Error('保存した会話を読み取れません。再接続するか、「新しいチャット」で開始し直してください。'); }
  }
  save(value) {
    const snapshot = validateSession(value);
    const task = this.pending.catch(() => {}).then(() => this.storage.set('lastSession', snapshot));
    this.pending = task;
    return task.catch(() => { throw Error('保存領域へ会話の状態を記録できません。処理を自動再送せず停止しました。'); });
  }
  async flush() {
    let timer;
    try { await Promise.race([this.pending.catch(() => {}), new Promise(resolve => { timer = setTimeout(resolve, 1000); })]); }
    finally { clearTimeout(timer); }
  }
}
async function readHistory(client, threadId) {
  const turns = [], cursors = new Set();
  let cursor = null, bytes = 0, omitted = false, pages = 0;
  do {
    const page = await client.request('thread/turns/list', { threadId, cursor, limit: 20, sortDirection: 'desc', itemsView: 'full' });
    if (!Array.isArray(page?.data)) throw Error('Codexの会話履歴の形式に対応していません。');
    for (const turn of page.data) {
      if (!object(turn) || !Array.isArray(turn.items)) throw Error('Codexの会話履歴の形式に対応していません。');
      bytes += Buffer.byteLength(JSON.stringify(turn));
      if (bytes > 6 * 1024 * 1024 || turns.length >= 200) { omitted = true; break; }
      turns.push(turn);
    }
    cursor = page.nextCursor || null;
    if (cursor && (typeof cursor !== 'string' || cursor.length > 16384 || cursors.has(cursor))) throw Error('Codexの会話履歴の表示位置が不正です。');
    cursors.add(cursor);
    if (turns.length >= 200 && cursor) omitted = true;
    if (++pages >= 20 && cursor) omitted = true;
  } while (cursor && !omitted);
  return { turns: turns.reverse(), omitted };
}
module.exports = { SessionStore, scopeFor, validateSession, readHistory };
