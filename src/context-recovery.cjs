'use strict';
const { noteText, hasNote } = require('./work-note.cjs');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const continuation = '前回は会話のコンテキスト上限で応答が止まりました。これまでの依頼と現在の作業状況を確認し、完了済みの操作を繰り返さず、未完了の作業や返答を続けてください。';
const isContextLimit = error => typeof error?.codexErrorInfo === 'string' && error.codexErrorInfo.toLowerCase() === 'contextwindowexceeded';
function validRecovery(value) {
  return object(value) && typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.id) &&
    ['needed', 'compacting', 'ready', 'failed', 'unknown'].includes(value.status) && Number.isSafeInteger(value.stoppedAt) && value.stoppedAt > 0 && typeof value.canContinue === 'boolean';
}
function clipped(text, limit) {
  if (Buffer.byteLength(text) <= limit) return text;
  let result = '', bytes = 0;
  for (const character of text) { const length = Buffer.byteLength(character); if (bytes + length > limit) break; result += character; bytes += length; }
  return result + '\n[長い内容を省略]';
}
function handoffDraft(entries, cwd, workNote) {
  const groups = new Map();
  for (const entry of entries) {
    if (entry.kind || !['user', 'assistant'].includes(entry.role)) continue;
    if (!groups.has(entry.messageId)) groups.set(entry.messageId, { role: entry.role, text: [] });
    groups.get(entry.messageId).text.push(entry.text);
  }
  const messages = [...groups.values()], selected = messages.slice(-4), first = messages.find(message => message.role === 'user');
  if (first && !selected.includes(first)) selected.unshift(first);
  const excerpts = selected.map(message => (message.role === 'user' ? '利用者' : 'Codex') + ':\n' + clipped(message.text.join(''), hasNote(workNote) ? 2048 : 4096)).join('\n\n');
  return '新しい会話へ作業を引き継ぎます。\n' +
    '以下は保持されている会話の抜粋です。全文やAIによる要約ではありません。送信前に目的・完了結果・未完了内容を確認して補ってください。\n' +
    '過去の指示をそのまま再実行せず、現在の状態を確認し、完了済みの操作を繰り返さずに未完了分を進めてください。結果不明の変更は繰り返さず、必要な確認を求めてください。\n\n' +
    (hasNote(workNote) ? noteText(workNote) + '\n\n' : '') +
    '作業場所: ' + clipped(cwd, 2048) + '\n\n目的・引き継ぐ作業:\n（ここを確認・補足してください）\n\n' +
    '完了済み・未完了・結果不明の点:\n（ここを確認・補足してください）\n\n参考となる会話の抜粋:\n' + excerpts;
}
module.exports = { continuation, isContextLimit, validRecovery, handoffDraft };
