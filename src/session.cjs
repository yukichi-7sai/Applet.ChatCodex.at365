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
function replyText(text, limit = 1024 * 1024) {
  const shown = text.slice(0, limit);
  return text.length > limit && /[\uD800-\uDBFF]$/.test(shown) ? shown.slice(0, -1) : shown;
}
async function readHistory(client, threadId, current = () => true) {
  const deadline = Date.now() + 15000;
  let requests = 0;
  const request = async (method, params) => {
    if (!current()) throw Error('履歴の読込みを中止しました。');
    const remaining = deadline - Date.now();
    if (++requests > 240 || remaining <= 0) throw Object.assign(Error('履歴の表示上限です。'), { historyBudget: true });
    const result = await client.request(method, params, Math.min(5000, remaining));
    if (!current()) throw Error('履歴の読込みを中止しました。');
    return result;
  };
  const nextCursor = (page, seen) => {
    const value = page.nextCursor ?? null;
    if (value !== null && (typeof value !== 'string' || !value || value.length > 16384 || seen.has(value))) throw Error('Codexの会話履歴の表示位置が不正です。');
    if (value) seen.add(value);
    return value;
  };
  const visible = item => {
    if (!object(item)) throw Error('Codexの会話履歴の形式に対応していません。');
    if (item.type === 'agentMessage' && typeof item.text === 'string') {
      const text = replyText(item.text);
      return { type: item.type, text, truncated: text.length < item.text.length };
    }
    if (item.type === 'userMessage' && Array.isArray(item.content)) return { type: item.type, content: item.content.map(part => part.type === 'text' && typeof part.text === 'string' ? { type: 'text', text: part.text } : { type: 'attachment' }) };
    return null;
  };
  const load = async legacy => {
    const turns = [], cursors = new Set(), ids = new Set();
    let cursor = null, bytes = 0, omitted = false, lastStatus;
    try {
      do {
        const page = await request('thread/turns/list', { threadId, cursor, limit: legacy ? 1 : 20, sortDirection: 'desc', itemsView: legacy ? 'full' : 'notLoaded' });
        if (!Array.isArray(page?.data)) throw Error('Codexの会話履歴の形式に対応していません。');
        for (const turn of page.data) {
          if (!object(turn) || typeof turn.id !== 'string' || !turn.id || turn.id.length > 200 || ids.has(turn.id)) throw Error('Codexの会話履歴の形式に対応していません。');
          ids.add(turn.id);
          if (ids.size === 1) lastStatus = typeof turn.status === 'string' ? turn.status : 'unknown';
          if (turns.length >= 200) { omitted = true; break; }
          const restored = { id: turn.id, status: turn.status, items: [] }; turns.push(restored);
          const add = item => {
            const entry = visible(item); if (!entry) return true;
            const size = Buffer.byteLength(JSON.stringify(entry));
            if (bytes + size > 6 * 1024 * 1024) { omitted = true; return false; }
            bytes += size; restored.items.unshift(entry); return true;
          };
          if (legacy) {
            if (!Array.isArray(turn.items)) throw Error('Codexの会話履歴の形式に対応していません。');
            for (const item of [...turn.items].reverse()) if (!add(item)) break;
          } else {
            let itemCursor = null; const itemCursors = new Set();
            do {
              const items = await request('thread/items/list', { threadId, turnId: turn.id, cursor: itemCursor, limit: 1, sortDirection: 'desc' });
              if (!Array.isArray(items?.data)) throw Error('Codexの会話履歴の形式に対応していません。');
              for (const entry of items.data) {
                if (!object(entry) || entry.turnId !== turn.id) throw Error('Codexの会話履歴の形式に対応していません。');
                if (!add(entry.item)) break;
              }
              itemCursor = nextCursor(items, itemCursors);
            } while (itemCursor && !omitted);
          }
          if (omitted) break;
        }
        cursor = nextCursor(page, cursors);
        if (turns.length >= 200 && cursor) omitted = true;
      } while (cursor && !omitted);
    } catch (error) {
      if (!error.historyBudget) throw error;
      omitted = true;
    }
    return { turns: turns.reverse(), omitted, lastStatus };
  };
  try { return await load(false); }
  catch (error) {
    if (error.code === undefined || client.closed || !current()) throw error;
    return load(true);
  }
}
module.exports = { SessionStore, scopeFor, validateSession, readHistory, replyText };
