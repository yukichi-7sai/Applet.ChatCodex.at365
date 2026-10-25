'use strict';
const fields = ['goal', 'completed', 'pending', 'uncertain'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function noteFields(value) {
  if (!object(value) || Object.keys(value).some(key => !fields.includes(key)) ||
      fields.some(key => typeof value[key] !== 'string' || Buffer.byteLength(value[key]) > 2048))
    throw Error('作業メモの各欄を短くしてください。各欄は日本語で約680文字まで保存できます。');
  return Object.fromEntries(fields.map(key => [key, value[key]]));
}
function validNote(value) {
  try {
    if (!object(value) || Object.keys(value).some(key => ![...fields, 'id', 'updatedAt'].includes(key)) ||
        typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id) ||
        !Number.isSafeInteger(value.updatedAt) || value.updatedAt <= 0 || !Number.isFinite(new Date(value.updatedAt).getTime())) return false;
    noteFields(Object.fromEntries(fields.map(key => [key, value[key]]))); return true;
  } catch { return false; }
}
const hasNote = note => !!note && fields.some(key => note[key].trim());
function noteText(note) {
  if (!hasNote(note)) return '';
  return '利用者が保存した作業メモ（現在の状態を保証するものではありません）:\n' +
    fields.map((key, index) => ['目的', '完了済み（確認済み）', '未完了', '結果不明・確認待ち'][index] + ':\n' + (note[key] || '（未記入）')).join('\n\n');
}
module.exports = { noteFields, validNote, hasNote, noteText };
