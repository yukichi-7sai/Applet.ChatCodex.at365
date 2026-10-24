'use strict';
const redacted = '[伏せ字]';
function secretKey(key) {
  const name = key.replace(/[^a-z]/gi, '').toLowerCase();
  return /(?:token|secret|password|apikey|cookie|authorization|credential)s?$/.test(name) || /^(encryptedcontent|encryptedreasoning|audiodata|audio)$/.test(name);
}
function cleanText(text) {
  return text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+\/_=.:-]+/gi, '$1 ' + redacted)
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, redacted)
    .replace(/(\b[\w-]*(?:token|secret|password|api[_-]?key)\s*[:=]\s*["']?)[^\s,;"'}]+/gi, '$1' + redacted)
    .replace(/(https?:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1' + redacted + '@')
    .replace(/([?&](?:access_token|refresh_token|token|api_key|password|secret)=)[^&#\s]*/gi, '$1' + redacted);
}
function sanitize(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 500 || depth > 8) return '[省略]';
  if (typeof value === 'string') {
    if (value.length < 64000 && /^[\s]*[\[{]/.test(value)) {
      try { return JSON.stringify(sanitize(JSON.parse(value), depth + 1, budget)); } catch {}
    }
    return cleanText(value.slice(0, 12000)) + (value.length > 12000 ? '\n[長い内容を省略]' : '');
  }
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitize(item, depth + 1, budget));
  if (value && typeof value === 'object') {
    const result = Object.create(null);
    for (const [key, item] of Object.entries(value).slice(0, 80)) {
      if (value.type === 'reasoning' && key === 'content') { result[key] = '[思考本文は表示対象外]'; continue; }
      result[cleanText(key)] = secretKey(key) ? redacted : sanitize(item, depth + 1, budget);
    }
    return result;
  }
  return value;
}
function wireView(event) {
  const method = event.method || event.message?.method || '応答';
  if (!event.method && !event.message?.method)
    return { direction: event.direction, id: event.message?.id, note: '対応する要求がない応答本文は表示しません。' };
  if (/^(account\/|config\/|mcpServer\/oauth\/)/.test(method))
    return { direction: event.direction, method, id: event.message?.id, note: '認証・設定に関する通信本文は表示しません。' };
  if (method === 'item/reasoning/textDelta')
    return { direction: event.direction, method, note: '思考本文は表示対象外です。' };
  return sanitize({ direction: event.direction, method, message: event.message });
}
function format(value) {
  const text = typeof value === 'string' ? cleanText(value) : JSON.stringify(sanitize(value), null, 2);
  return text.length > 16000 ? text.slice(0, 16000) + '\n[表示上限により省略]' : text;
}
module.exports = { sanitize, wireView, format };
