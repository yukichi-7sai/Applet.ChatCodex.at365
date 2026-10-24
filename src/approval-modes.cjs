'use strict';
const modes = [
  { id: 'inherit', label: 'Codexの設定に従う', description: 'この端末のCodex設定で定義された権限を使用します。' },
  { id: 'ask', label: '確認して実行', description: '作業領域の外へのアクセスなど、必要な操作を確認します。' },
  { id: 'auto', label: '自動審査', description: '必要な承認要求をCodexが審査します。自動許可とは異なります。' },
  { id: 'full', label: 'フルアクセス', description: 'ローカルのファイルとネットワークへのアクセスを広く許可します。' },
];
const validMode = mode => modes.some(item => item.id === mode);
function threadDefaults(response) {
  if ((!response.approvalPolicy || !['string', 'object'].includes(typeof response.approvalPolicy)) ||
      !['user', 'auto_review', 'guardian_subagent'].includes(response.approvalsReviewer) ||
      !response.sandbox || typeof response.sandbox.type !== 'string')
    throw Error('Codexの承認設定を確認できません。このCodex版の対応状況を確認してください。');
  return structuredClone({ approvalPolicy: response.approvalPolicy, approvalsReviewer: response.approvalsReviewer, sandboxPolicy: response.sandbox });
}
function turnPolicy(mode, defaults) {
  if (!validMode(mode)) throw Error('承認モードを選んでください。');
  if (mode === 'inherit') return structuredClone(defaults);
  return {
    approvalPolicy: mode === 'full' ? 'never' : 'on-request',
    approvalsReviewer: mode === 'auto' ? 'auto_review' : 'user',
    sandboxPolicy: mode === 'full' ? { type: 'dangerFullAccess' }
      : { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
  };
}
module.exports = { modes, validMode, threadDefaults, turnPolicy };
