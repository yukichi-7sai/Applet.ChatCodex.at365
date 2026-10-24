'use strict';
const $ = id => document.getElementById(id);
const effortNames = { none: 'なし', minimal: '最小', low: '低', medium: '標準', high: '高', xhigh: '非常に高い', max: '最大', ultra: '最高' };
let generation = 0, after = 0, state, draftSelection, performing = false, reading = false, readAgain = false, autoConnected = false, composing = false;
const entries = new Map(), bubbles = new Map(), cards = new Map();
const labels = { disconnected: '未接続', connecting: '接続中…', idle: '接続済み', running: '応答中…', awaitingInput: '返答を待っています', stopping: '停止中…', error: '接続を確認してください' };
const call = (id, input = {}) => window.appletPage.call('actions.invoke', { id, input: { generation, ...input } });
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function option(value, label) { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; }
function renderControls() {
  if (!state) return;
  const selected = draftSelection || state.selection;
  $('model').replaceChildren(option('', 'モデルを選択'));
  for (const model of state.models) $('model').append(option(model.model, model.name));
  if (selected.model && !state.models.some(model => model.model === selected.model)) $('model').append(option(selected.model, selected.model + '（利用不可）'));
  $('model').value = selected.model;
  const model = state.models.find(model => model.model === selected.model);
  $('effort').replaceChildren(option('', model?.efforts.length ? '思考量を選択' : '指定なし'));
  for (const effort of model?.efforts || []) $('effort').append(option(effort, effortNames[effort] || effort));
  $('effort').value = selected.effort;
  const idle = state.state === 'idle' && !performing && !state.saving;
  $('model').disabled = !idle;
  $('effort').disabled = !idle || !model?.efforts.length;
  $('new-chat').disabled = !idle || !!draftSelection;
  const active = ['running', 'awaitingInput', 'stopping'].includes(state.state);
  $('send').textContent = active ? (state.state === 'stopping' ? '停止中…' : '停止') : '送信';
  const valid = model && (!model.efforts.length || model.efforts.includes(selected.effort));
  $('send').disabled = performing || (active ? state.state === 'stopping' : !idle || !valid || !!draftSelection || !$('input').value.trim());
  $('connect').hidden = !['error', 'disconnected'].includes(state.state);
  $('connect').disabled = performing;
  $('status').textContent = (labels[state.state] || state.state) + (state.detail ? ' — ' + state.detail : '');
}
function renderEntries(records) {
  for (const entry of records) entries.set(entry.id, entry);
  for (const [id, entry] of entries) if (entry.order < state.minOrder) entries.delete(id);
  const groups = new Map();
  for (const entry of [...entries.values()].sort((a, b) => a.order - b.order)) {
    if (!groups.has(entry.messageId)) groups.set(entry.messageId, []);
    groups.get(entry.messageId).push(entry);
  }
  for (const [id, node] of bubbles) if (!groups.has(id)) { node.remove(); bubbles.delete(id); }
  for (const [id, parts] of groups) {
    let node = bubbles.get(id);
    if (!node) {
      node = document.createElement('article'); node.className = 'message'; node.dataset.role = parts[0].role;
      const title = document.createElement('div'); title.className = 'message-title'; title.textContent = parts[0].role === 'user' ? 'あなた' : 'Codex';
      const text = document.createElement('div'); text.className = 'message-text';
      node.append(title, text); bubbles.set(id, node);
    }
    const text = parts.map(part => part.text).join('');
    if (node.lastChild.textContent !== text) node.lastChild.textContent = text;
    $('messages').append(node);
  }
  $('empty').hidden = entries.size > 0;
  $('omitted').hidden = !state.omitted;
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
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !composing) {
    event.preventDefault();
    if (!['running', 'awaitingInput', 'stopping'].includes(state?.state) && !$('send').disabled) $('composer').requestSubmit();
  }
});
$('composer').addEventListener('submit', event => {
  event.preventDefault();
  if ($('send').disabled) return;
  if (['running', 'awaitingInput'].includes(state?.state)) { void perform(() => call('chat.stop')); return; }
  const text = $('input').value;
  void perform(async () => {
    await call('chat.send', { requestId: crypto.randomUUID(), text });
    if ($('input').value === text) $('input').value = '';
  });
});
$('new-chat').addEventListener('click', () => void perform(async () => { await call('chat.new'); $('input').value = ''; }));
$('connect').addEventListener('click', () => void perform(() => call('chat.connect')));
const unsubscribe = window.appletPage.onChanged(() => {
  void window.appletPage.snapshot().then(snapshot => { document.documentElement.style.colorScheme = snapshot.dark ? 'dark' : 'light'; }).catch(() => {});
  void refresh();
});
window.addEventListener('pagehide', unsubscribe, { once: true });
void window.appletPage.snapshot().then(snapshot => { document.documentElement.style.colorScheme = snapshot.dark ? 'dark' : 'light'; });
void refresh();
