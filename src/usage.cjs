'use strict';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const continuation = '前回は利用制限のため作業が止まりました。これまでの依頼と現在のファイル・設定・実行結果を確認し、完了済みの操作を繰り返さず、未完了の作業を続けてください。';
function limitReason(error) {
  const info = error?.codexErrorInfo;
  if (typeof info === 'string') {
    if (info.toLowerCase() === 'usagelimitexceeded') return 'usage';
    if (info.toLowerCase() === 'ratelimitexceeded') return 'rate';
  }
  if (object(info) && Object.entries(info).some(([key, value]) =>
    ['httpConnectionFailed', 'responseStreamConnectionFailed', 'responseStreamDisconnected', 'responseTooManyFailedAttempts'].includes(key) && value?.httpStatusCode === 429)) return 'rate';
  return null;
}
function usageSnapshot(response, now = Date.now()) {
  if (!object(response) || Buffer.byteLength(JSON.stringify(response)) > 128 * 1024) throw Error('Unsupported usage response');
  if (response.rateLimitsByLimitId != null && !object(response.rateLimitsByLimitId)) throw Error('Unsupported usage buckets');
  const buckets = Object.values(response.rateLimitsByLimitId || {});
  if (!buckets.length && object(response.rateLimits)) buckets.push(response.rateLimits);
  if (buckets.length > 100 || buckets.some(bucket => !object(bucket))) throw Error('Unsupported usage buckets');
  const windows = [], blocked = response.ordinaryUsageAllowed === false || buckets.some(bucket =>
    typeof bucket.rateLimitReachedType === 'string' && !!bucket.rateLimitReachedType || bucket.spendControlReached === true);
  for (const bucket of buckets) for (const key of ['primary', 'secondary']) {
    const window = bucket[key];
    if (window == null) continue;
    if (!object(window) || !Number.isInteger(window.usedPercent)) throw Error('Unsupported usage window');
    windows.push({ label: String(bucket.limitName || bucket.limitId || 'Codex').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80),
      usedPercent: Math.max(0, Math.min(100, window.usedPercent)),
      durationMins: Number.isSafeInteger(window.windowDurationMins) && window.windowDurationMins > 0 ? window.windowDurationMins : null,
      resetsAt: Number.isSafeInteger(window.resetsAt) && window.resetsAt > 0 && window.resetsAt <= 8640000000000 ? window.resetsAt : null });
  }
  const exhausted = windows.filter(window => window.usedPercent >= 100);
  return { status: blocked ? 'blocked' : response.ordinaryUsageAllowed === true ? 'available' : 'unknown', checkedAt: now,
    // Percentages and elapsed reset times alone must never establish recovery.
    nextReset: exhausted.length && exhausted.every(window => window.resetsAt) ? Math.max(...exhausted.map(window => window.resetsAt)) : null,
    windows: windows.slice(0, 20), omitted: windows.length > 20 };
}
function validPause(value) {
  return object(value) && typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.id) &&
    ['usage', 'rate'].includes(value.kind) && Number.isSafeInteger(value.stoppedAt) && value.stoppedAt > 0 && typeof value.canContinue === 'boolean';
}
module.exports = { continuation, limitReason, usageSnapshot, validPause };
