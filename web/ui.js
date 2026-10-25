'use strict';
const $ = id => document.getElementById(id);
const effortNames = { none: 'なし', minimal: '最小', low: '低', medium: '標準', high: '高', xhigh: '非常に高い', max: '最大', ultra: '最高' };
const approvalIcons = {
  inherit: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM10 2h4l1 3 3 1 3 1v4l-2 1-1 3 1 3-3 3-3-1-3 1-3-2-1-3-3-1V9l3-1 1-3Z',
  ask: 'M9 11V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v7c0 5-3 8-8 8-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-3l3 3Z',
  auto: 'M12 3a9 9 0 1 0 9 9M12 6v6l4 2M17 4l2 2 3-3',
  full: 'M12 3 3 7v6c0 4 4 7 9 9 5-2 9-5 9-9V7ZM12 8v5m0 4h.01',
};
let generation = 0, after = 0, state, draftSelection, performing = false, reading = false, readAgain = false, autoConnected = false, composing = false;
const entries = new Map(), bubbles = new Map(), cards = new Map();
const labels = { disconnected: '未接続', connecting: '接続中…', idle: '接続済み', running: '応答中…', awaitingInput: '返答を待っています', stopping: '停止中…', compacting: '会話を圧縮中…', saving: '会話を保存しています…', error: '接続を確認してください' };
const call = (id, input = {}) => window.appletPage.call('actions.invoke', { id, input: { generation, ...input } });
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function option(value, label) { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; }
function approvalIcon(mode) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('control-icon');
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', approvalIcons[mode] || approvalIcons.inherit); svg.append(path); return svg;
}
function renderApproval(idle) {
  const modes = state.approvalModes || [];
  const selected = modes.find(mode => mode.id === state.approvalMode);
  $('approval-label').textContent = selected?.label || '承認モードを選択';
  $('approval-icon').setAttribute('d', approvalIcons[state.approvalMode] || approvalIcons.inherit);
  $('approval').disabled = !idle;
  $('approval').classList.toggle('is-full', state.approvalMode === 'full');
  $('approval').setAttribute('aria-label', '承認モード: ' + (selected?.label || '未選択'));
  $('approval').title = selected?.description || '承認モードを選んでください。';
  if (!$('approval-options').children.length) for (const mode of modes) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'mode-option';
    button.dataset.mode = mode.id; button.setAttribute('role', 'menuitemradio');
    button.classList.toggle('is-full', mode.id === 'full');
    const copy = document.createElement('span'); copy.className = 'mode-copy';
    const title = document.createElement('span'); title.className = 'mode-title'; title.textContent = mode.label;
    const description = document.createElement('span'); description.className = 'mode-description'; description.textContent = mode.description;
    const check = document.createElement('span'); check.className = 'mode-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
    copy.append(title, description); button.append(approvalIcon(mode.id), copy, check);
    button.addEventListener('click', () => {
      $('approval-menu').hidePopover(); $('approval').focus();
      void perform(() => call('chat.approval', { mode: mode.id }));
    });
    $('approval-options').append(button);
  }
  for (const button of $('approval-options').children) {
    button.disabled = !idle; button.setAttribute('aria-checked', String(button.dataset.mode === state.approvalMode));
    button.tabIndex = button.dataset.mode === state.approvalMode ? 0 : -1;
  }
  if (!idle && $('approval-menu').matches(':popover-open')) $('approval-menu').hidePopover();
}
function positionApprovalMenu() {
  const menu = $('approval-menu'), anchor = $('approval').getBoundingClientRect();
  const box = menu.getBoundingClientRect();
  menu.style.left = Math.max(12, Math.min(anchor.left, innerWidth - box.width - 12)) + 'px';
  menu.style.top = Math.max(12, Math.min(anchor.top - box.height - 8, innerHeight - box.height - 12)) + 'px';
}
function usageTime(seconds) {
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(seconds * 1000));
}
function renderUsage(valid) {
  const usage = state.usage;
  $('usage-panel').hidden = !usage || !!state.contextRecovery && usage.status === 'available';
  if (!usage) return;
  $('usage-title').textContent = usage.kind === 'usage' ? 'Codexの利用制限で停止しました' : 'Codexの一時的な送信制限で停止しました';
  const labels = {
    unknown: '利用可能な状態か確認できていません。時間をおいて、もう一度利用状況を確認してください。',
    blocked: '利用制限が続いています。時間をおいて、利用状況を確認してください。',
    available: '利用可能な状態を確認しました。［作業を再開］から続けられます。',
    unavailable: '利用状況を取得できませんでした。時間をおいて、もう一度確認してください。',
  };
  $('usage-status').textContent = usage.checking ? '利用状況を確認しています…' : usage.note || (!usage.canContinue
    ? 'この送信が保存されたか確認できません。元の依頼を確認し、入力欄から送信してください。' : labels[usage.status] || labels.unknown);
  $('usage-reset').textContent = usage.nextReset ? '次のリセット予定：' + usageTime(usage.nextReset) + '（この端末の時刻）' : 'リセット予定時刻は取得できていません。';
  $('usage-checked').textContent = usage.checkedAt ? '最終確認：' + usageTime(usage.checkedAt / 1000) : '';
  $('usage-windows').replaceChildren();
  for (const window of usage.windows || []) {
    const duration = window.durationMins;
    const period = !duration ? '利用枠' : duration % 1440 === 0 ? duration / 1440 + '日枠' : duration % 60 === 0 ? duration / 60 + '時間枠' : duration + '分枠';
    const row = document.createElement('li');
    row.textContent = window.label + '・' + period + '：使用率 ' + window.usedPercent + '%／リセット予定 ' + (window.resetsAt ? usageTime(window.resetsAt) : '不明');
    $('usage-windows').append(row);
  }
  $('usage-details').hidden = !usage.windows?.length;
  const idle = state.state === 'idle' && !performing && !state.saving && !usage.checking;
  $('usage-check').disabled = !idle;
  $('usage-resume').disabled = !idle || usage.status !== 'available' || !usage.canContinue || !valid || !!draftSelection;
  $('usage-resume').hidden = !!state.contextRecovery;
  $('usage-context').hidden = !state.contextRecovery;
}
function renderContext(valid) {
  const recovery = state.contextRecovery;
  $('context-panel').hidden = !recovery || !!state.usage && state.usage.status !== 'available';
  if (!recovery) return;
  const text = {
    needed: '会話が長くなっています。Codexで要点を圧縮すると、同じ会話で続きを送れる場合があります。',
    compacting: 'Codexで会話を圧縮しています。完了するまでお待ちください。',
    ready: '会話の圧縮が完了しました。［作業を再開］から続きを送れます。',
    failed: '会話を圧縮できませんでした。やり直すか、新しいチャットへの引き継ぎを選べます。',
    unknown: '前回の圧縮が完了したか確認できません。やり直すか、新しいチャットへの引き継ぎを選べます。',
  };
  $('context-status').textContent = recovery.status === 'ready' && !recovery.canContinue ? '元の依頼が保存されたか確認できません。入力欄から確認して送信してください。' : text[recovery.status] || text.unknown;
  const idle = state.state === 'idle' && !performing && !state.saving && !state.usage?.checking;
  $('context-compact').hidden = recovery.status === 'ready';
  $('context-compact').disabled = !idle;
  $('context-continue').hidden = recovery.status !== 'ready';
  $('context-continue').disabled = !idle || !recovery.canContinue || !valid || !!draftSelection || !!state.usage;
  $('context-handoff').disabled = !idle;
  $('context-hint').hidden = recovery.status === 'compacting';
}
function renderControls() {
  if (!state) return;
  $('history-note').textContent = state.historyNotice || ''; $('history-note').hidden = !state.historyNotice;
  $('restore-light').hidden = !state.canRestoreWithoutHistory;
  $('restore-light').disabled = performing || state.state !== 'error';
  const selected = draftSelection || state.selection;
  $('model').replaceChildren(option('', 'モデルを選択'));
  for (const model of state.models) $('model').append(option(model.model, model.name));
  if (selected.model && !state.models.some(model => model.model === selected.model)) $('model').append(option(selected.model, selected.model + '（利用不可）'));
  $('model').value = selected.model;
  const model = state.models.find(model => model.model === selected.model);
  $('effort').replaceChildren(option('', model?.efforts.length ? '思考量を選択' : '指定なし'));
  for (const effort of model?.efforts || []) $('effort').append(option(effort, effortNames[effort] || effort));
  $('effort').value = selected.effort;
  const idle = state.state === 'idle' && !performing && !state.saving && !state.usage?.checking;
  renderApproval(idle);
  $('model').disabled = !idle;
  $('effort').disabled = !idle || !model?.efforts.length;
  $('new-chat').disabled = !(idle || state.canStartNew && !performing && !state.saving) || !!draftSelection;
  const active = ['running', 'awaitingInput', 'stopping', 'compacting'].includes(state.state);
  const sendLabel = active ? (state.state === 'stopping' ? '停止中…' : '停止') : '送信';
  $('send-label').textContent = sendLabel; $('send').setAttribute('aria-label', sendLabel); $('send').title = sendLabel;
  $('send').classList.toggle('is-stop', active);
  $('send-icon').setAttribute('d', active ? 'M7 7h10v10H7Z' : 'M12 19V5m-6 6 6-6 6 6');
  const valid = state.approvalModes?.some(mode => mode.id === state.approvalMode) && model && (!model.efforts.length || model.efforts.includes(selected.effort));
  renderUsage(valid);
  renderContext(valid);
  $('send').disabled = performing || (active ? state.state === 'stopping' : !idle || !valid || !!draftSelection || !$('input').value.trim());
  $('connect').hidden = !['error', 'disconnected'].includes(state.state);
  $('connect').disabled = performing;
  $('status').textContent = (labels[state.state] || state.state) + (state.detail ? ' — ' + state.detail : '');
  $('settings-note').hidden = !state.settingsPending;
  $('session-note').textContent = state.sessionNotice || '';
  $('session-note').hidden = !state.sessionNotice;
  const shortcut = state.sendKey === 'enter' ? 'Enter' : 'Ctrl+Enter';
  $('input-hint').textContent = shortcut + 'で送信・' + (state.sendKey === 'enter' ? 'Shift+Enter' : 'Enter') + 'で改行';
  if (!active) $('send').title = '送信（' + shortcut + '）';
}
function renderEntries(records) {
  for (const entry of records) entries.set(entry.id, entry);
  for (const [id, entry] of entries) if (entry.order < (state.minOrders?.[entry.kind || 'message'] ?? state.minOrder)) entries.delete(id);
  const groups = new Map();
  for (const entry of [...entries.values()].sort((a, b) => a.order - b.order)) {
    if (entry.kind === 'detail' && state.displayMode !== 'detail') continue;
    if (entry.kind === 'trace' && !state.wireLogEnabled) continue;
    if (!groups.has(entry.messageId)) groups.set(entry.messageId, []);
    groups.get(entry.messageId).push(entry);
  }
  for (const [id, node] of bubbles) if (!groups.has(id)) { node.remove(); bubbles.delete(id); }
  for (const [id, parts] of groups) {
    let node = bubbles.get(id);
    if (!node) {
      node = document.createElement(parts[0].kind ? 'details' : 'article'); node.className = 'message'; node.dataset.role = parts[0].role;
      if (parts[0].kind) node.dataset.kind = parts[0].kind;
      const title = document.createElement(parts[0].kind ? 'summary' : 'div'); title.className = 'message-title';
      title.textContent = parts[0].kind ? parts[0].title : parts[0].role === 'user' ? 'あなた' : 'Codex';
      const text = document.createElement(parts[0].kind ? 'pre' : 'div'); text.className = 'message-text';
      node.append(title, text); bubbles.set(id, node);
    }
    const text = parts.map(part => part.text).join(''), body = node.querySelector('.message-text');
    if (body.textContent !== text) body.textContent = text;
    let truncated = node.querySelector('.reply-truncated');
    if (parts.some(part => part.truncated)) {
      if (!truncated) { truncated = document.createElement('p'); truncated.className = 'reply-truncated'; truncated.textContent = '長いため、返答の表示を一部省略しています。'; node.append(truncated); }
    } else truncated?.remove();
    $('messages').append(node);
  }
  $('empty').hidden = groups.size > 0;
  $('omitted').hidden = !state.omitted;
  $('reply-note').hidden = !state.replyOmitted;
  const notes = [];
  if (state.displayMode === 'detail' && state.diagnosticsOmitted?.detail) notes.push('古い詳細情報を整理して、最新の記録を続けています。');
  if (state.wireLogEnabled && state.diagnosticsOmitted?.trace) notes.push('古い通信ログを整理して、最新の記録を続けています。');
  const diagnosticNote = notes.join(' ');
  if ($('diagnostic-note').textContent !== diagnosticNote) $('diagnostic-note').textContent = diagnosticNote;
  $('diagnostic-note').hidden = !diagnosticNote;
}
async function perform(action) {
  if (performing) return;
  performing = true; notice(); renderControls();
  try { await action(); } catch (error) { notice(error.message || '操作に失敗しました。'); }
  finally { performing = false; await refresh(); renderControls(); }
}
function renderRequests() {
  const ids = new Set(state.requests.map(request => request.id));
  for (const [id, node] of cards) if (!ids.has(id)) { node.remove(); cards.delete(id); }
  for (const request of state.requests) {
    if (cards.has(request.id)) continue;
    const card = document.createElement('section'); card.className = 'request'; card.dataset.requestId = request.id;
    const heading = document.createElement('h2'); heading.textContent = request.title; card.append(heading);
    const answers = new Map();
    if (request.detail) { const detail = document.createElement('p'); detail.textContent = request.detail; card.append(detail); }
    for (const question of request.questions || []) {
      const label = document.createElement('label'); label.className = 'question'; label.append(document.createTextNode(question.title));
      let input;
      if (question.options.length && !question.other) {
        input = document.createElement('select'); input.append(option('', '選択してください'));
        for (const item of question.options) input.append(option(item.label, item.label));
      } else {
        input = document.createElement('input'); input.type = 'text'; input.maxLength = 4000;
        if (question.options.length) {
          const list = document.createElement('datalist'); list.id = 'options-' + crypto.randomUUID();
          for (const item of question.options) list.append(option(item.label, item.label));
          input.setAttribute('list', list.id); label.append(list);
        }
      }
      input.className = 'question-input'; input.dataset.questionId = question.id; label.append(input); answers.set(question.id, input); card.append(label);
    }
    const actions = document.createElement('div'); actions.className = 'request-actions';
    const submit = async response => {
      const requestGeneration = generation;
      await perform(async () => {
        for (const button of actions.querySelectorAll('button')) button.disabled = true;
        try { await call('chat.respond', { generation: requestGeneration, requestId: request.id, response: JSON.stringify(response) }); }
        catch (error) { for (const button of actions.querySelectorAll('button')) button.disabled = false; throw error; }
      });
    };
    const choices = request.kind === 'approval' ? request.choices : ['answer', 'cancel'];
    for (const choice of choices) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.choice = choice;
      button.textContent = { accept: '今回だけ許可', decline: '許可しない', cancel: 'キャンセル', answer: '回答する' }[choice];
      button.addEventListener('click', () => void submit(choice === 'answer' ? { answers: Object.fromEntries([...answers].map(([id, input]) => [id, input.value])) } : { decision: choice }));
      actions.append(button);
    }
    card.append(actions); cards.set(request.id, card); $('requests').append(card);
  }
}
async function refresh() {
  if (reading) { readAgain = true; return; }
  reading = true;
  try {
    do {
      readAgain = false;
      const follow = $('conversation').scrollHeight - $('conversation').scrollTop - $('conversation').clientHeight < 64;
      const result = await call('chat.read', { after });
      if (result.reset) {
        entries.clear(); bubbles.clear(); cards.clear(); $('messages').replaceChildren(); $('requests').replaceChildren();
        draftSelection = undefined;
      }
      generation = result.generation; after = result.after; state = result;
      renderEntries(result.entries); renderRequests(); renderControls();
      if (follow) $('conversation').scrollTop = $('conversation').scrollHeight;
      if (result.more) readAgain = true;
      if (!autoConnected && state.state === 'disconnected') {
        autoConnected = true; await call('chat.connect'); readAgain = true;
      }
    } while (readAgain);
  } catch (error) { notice(error.message || '表示の更新に失敗しました。'); }
  finally { reading = false; }
}
async function select() {
  const model = state.models.find(item => item.model === $('model').value);
  if (!model) return;
  const effort = $('effort').value;
  draftSelection = { model: model.model, effort };
  if (model.efforts.length && !model.efforts.includes(effort)) { renderControls(); return; }
  await perform(async () => { await call('chat.select', { model: model.model, effort }); draftSelection = undefined; });
}
$('model').addEventListener('change', () => {
  const model = state.models.find(item => item.model === $('model').value);
  if (!model) return;
  const effort = model.efforts.includes(state.selection.effort) ? state.selection.effort : model.efforts.includes(model.defaultEffort) ? model.defaultEffort : '';
  draftSelection = { model: model.model, effort }; renderControls(); void select();
});
$('effort').addEventListener('change', () => void select());
$('input').addEventListener('input', renderControls);
$('input').addEventListener('compositionstart', () => { composing = true; });
$('input').addEventListener('compositionend', () => { composing = false; });
$('input').addEventListener('keydown', event => {
  const sendOnControl = state?.sendKey !== 'enter';
  if (event.key === 'Enter' && event.ctrlKey === sendOnControl && !event.shiftKey && !event.altKey && !event.metaKey && !event.isComposing && !composing && event.keyCode !== 229) {
    event.preventDefault();
    if (!['running', 'awaitingInput', 'stopping', 'compacting'].includes(state?.state) && !$('send').disabled) $('composer').requestSubmit();
  }
});
$('composer').addEventListener('submit', event => {
  event.preventDefault();
  if ($('send').disabled) return;
  if (['running', 'awaitingInput', 'compacting'].includes(state?.state)) { void perform(() => call('chat.stop')); return; }
  const text = $('input').value;
  void perform(async () => {
    await call('chat.send', { requestId: crypto.randomUUID(), text });
    if ($('input').value === text) $('input').value = '';
  });
});
$('new-chat').addEventListener('click', () => void perform(async () => { await call('chat.new'); $('input').value = ''; }));
$('connect').addEventListener('click', () => void perform(() => call('chat.connect')));
$('restore-light').addEventListener('click', () => void perform(() => call('chat.restore-light')));
$('usage-check').addEventListener('click', () => void perform(() => call('chat.usage')));
$('usage-resume').addEventListener('click', () => void perform(() => call('chat.resume', { requestId: crypto.randomUUID(), pauseId: state.usage?.pauseId })));
$('context-compact').addEventListener('click', () => void perform(() => call('chat.compact', { requestId: crypto.randomUUID(), recoveryId: state.contextRecovery?.id })));
$('context-continue').addEventListener('click', () => void perform(() => call('chat.context-continue', { requestId: crypto.randomUUID(), recoveryId: state.contextRecovery?.id })));
$('context-handoff').addEventListener('click', () => void perform(async () => {
  const result = await call('chat.handoff', { recoveryId: state.contextRecovery?.id });
  $('input').value = result.draft; $('input').focus(); $('input').setSelectionRange(0, 0); $('input').scrollTop = 0;
}));
$('approval-menu').addEventListener('toggle', event => {
  const open = event.newState === 'open'; $('approval').setAttribute('aria-expanded', String(open));
  if (open) { positionApprovalMenu(); $('approval-options').querySelector('[aria-checked="true"]')?.focus(); }
});
$('approval-menu').addEventListener('keydown', event => {
  const buttons = [...$('approval-options').querySelectorAll('button:enabled')];
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || !buttons.length) return;
  event.preventDefault();
  const current = buttons.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
});
window.addEventListener('resize', () => { if ($('approval-menu').matches(':popover-open')) positionApprovalMenu(); });
const unsubscribe = window.appletPage.onChanged(() => {
  void window.appletPage.snapshot().then(snapshot => { document.documentElement.style.colorScheme = snapshot.dark ? 'dark' : 'light'; }).catch(() => {});
  void refresh();
});
window.addEventListener('pagehide', unsubscribe, { once: true });
void window.appletPage.snapshot().then(snapshot => { document.documentElement.style.colorScheme = snapshot.dark ? 'dark' : 'light'; });
void refresh();
