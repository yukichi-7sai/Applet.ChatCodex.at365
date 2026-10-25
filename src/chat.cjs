'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { CodexProcess } = require('./codex-process.cjs');
const { modes, validMode, threadDefaults, turnPolicy } = require('./approval-modes.cjs');
const { normalizeSettings, startupOptions, threadConfig } = require('./chat-settings.cjs');
const { format, wireView } = require('./diagnostics.cjs');
const { SessionStore, scopeFor, readHistory, replyText } = require('./session.cjs');
const { continuation, limitReason, usageSnapshot } = require('./usage.cjs');
const { continuation: contextContinuation, isContextLimit, handoffDraft } = require('./context-recovery.cjs');
const busy = new Set(['connecting', 'running', 'awaitingInput', 'stopping', 'saving', 'compacting']);
const textLimit = 32768;
const replyLimit = 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const short = (value, max = 4000) => typeof value === 'string' ? value.slice(0, max) : '';

function modelsFrom(data) {
  if (!Array.isArray(data)) throw Error('Codexのモデル一覧形式に対応していません。');
  return data.filter(item => object(item) && !item.hidden && typeof item.model === 'string' && item.model.length <= 200)
    .map(item => ({
      model: item.model, name: short(item.displayName, 200) || item.model,
      isDefault: item.isDefault === true, defaultEffort: short(item.defaultReasoningEffort, 50),
      efforts: Array.isArray(item.supportedReasoningEfforts)
        ? [...new Set(item.supportedReasoningEfforts.map(e => e.reasoningEffort).filter(e => typeof e === 'string' && e.length <= 50))] : [],
    }));
}

class Chat {
  constructor({ clientFactory = () => new CodexProcess(), storage, getHostInfo, changed = () => {}, failed = () => {}, settings } = {}) {
    this.clientFactory = clientFactory;
    this.storage = storage;
    this.sessions = new SessionStore(storage);
    this.getHostInfo = getHostInfo;
    this.changed = changed;
    this.failed = failed;
    this.generation = 1;
    this.state = 'disconnected';
    this.detail = '';
    this.models = [];
    this.selection = { model: '', effort: '' };
    this.approvalMode = 'inherit';
    this.entries = [];
    this.revision = 0;
    this.order = 0;
    this.requests = new Map();
    this.accepted = new Map();
    this.closed = false;
    this.saving = false;
    this.pause = null; this.usage = null; this.usageOperation = null;
    this.contextRecovery = null; this.compactAccepted = new Map(); this.nextCwd = null;
    this.canRestoreWithoutHistory = false; this.historyNotice = '';
    this.settings = normalizeSettings(settings);
    this.resetDiagnostics();
  }
  touch() {
    if (this.closed || this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined;
      if (!this.closed) Promise.resolve(this.changed()).catch(() => {});
    }, 60);
  }
  entry(role, text, id = randomUUID(), metadata = {}) {
    const parts = [];
    for (let offset = 0; offset < Math.max(1, text.length); offset += 4096) {
      const entry = { id: id + ':' + offset, messageId: id, role, text: text.slice(offset, offset + 4096), order: ++this.order, revision: ++this.revision, ...metadata };
      this.entries.push(entry); parts.push(entry);
    }
    this.trim();
    this.touch();
    return parts;
  }
  diagnostic(kind, title, value) {
    if (kind === 'trace' ? !this.settings.wireLogEnabled : this.settings.displayMode !== 'detail') return;
    const log = this.diagnostics[kind];
    if (!log) return;
    const text = format(value);
    const id = randomUUID(), bytes = Buffer.byteLength(text);
    this.entry('system', text, id, { kind, title: title.slice(0, 200) });
    log.messages.push({ id, bytes }); log.bytes += bytes;
    const removed = new Set();
    while (log.bytes > 512 * 1024 || log.messages.length > 400) {
      const oldest = log.messages.shift(); log.bytes -= oldest.bytes; removed.add(oldest.id);
    }
    if (removed.size) {
      this.entries = this.entries.filter(entry => !removed.has(entry.messageId));
      log.omitted = true;
    }
    this.touch();
  }
  resetDiagnostics() {
    this.diagnostics = { detail: { bytes: 0, messages: [], omitted: false }, trace: { bytes: 0, messages: [], omitted: false } };
  }
  setSettings(settings) {
    const previous = this.settings.displayMode;
    const previousWire = this.settings.wireLogEnabled;
    this.settings = normalizeSettings(settings);
    if (previous === 'normal' && this.settings.displayMode !== 'normal') {
      this.diagnostic('detail', '詳細表示の範囲', '変更後に受け取る情報を表示します。過去の通信は追加取得しません。Codex内部の最終指示やメモリ要約本文は、APIが返さない場合は表示できません。');
      if (this.threadContext) this.diagnostic('detail', 'この会話の開始時の情報', this.threadContext);
    }
    if (!previousWire && this.settings.wireLogEnabled)
      this.diagnostic('trace', '通信ログの範囲', '有効にした後の通信を表示します。古い通信ログから整理し、最新の記録を続けます。過去の通信は追加取得しません。');
    this.touch();
  }
  trim() {
    let size = this.entries.reduce((sum, entry) => sum + (entry.kind ? 0 : Buffer.byteLength(entry.text)), 0);
    const removed = new Set();
    for (const entry of this.entries) {
      if (size <= 8 * 1024 * 1024) break;
      if (entry.kind) continue;
      if (entry.active) break;
      size -= Buffer.byteLength(entry.text); removed.add(entry.id);
    }
    if (removed.size) { this.entries = this.entries.filter(entry => !removed.has(entry.id)); this.omitted = true; }
  }
  append(itemId, delta) {
    if (!delta) return;
    let item = this.items?.get(itemId);
    if (!item) {
      item = { id: itemId, parts: this.entry('assistant', '', itemId), length: 0 };
      this.items.set(itemId, item);
    }
    if (item.completed || item.omitted) return;
    const remaining = replyLimit - item.length, omitted = delta.length > remaining;
    delta = replyText(delta, remaining);
    item.length += delta.length;
    while (delta.length) {
      let part = item.parts.at(-1);
      if (part.text.length >= 4096) {
        part = this.entry('assistant', '', itemId + ':part:' + item.parts.length)[0];
        part.id = itemId + ':' + item.parts.length * 4096;
        part.messageId = itemId;
        item.parts.push(part);
      }
      const length = Math.min(4096 - part.text.length, delta.length);
      part.text += delta.slice(0, length);
      delta = delta.slice(length);
      part.revision = ++this.revision;
      part.active = true;
    }
    if (omitted) {
      item.omitted = true;
      const part = item.parts.at(-1);
      if (/[\uD800-\uDBFF]$/.test(part.text)) { part.text = part.text.slice(0, -1); item.length--; }
      part.truncated = true; part.revision = ++this.revision;
    }
    this.trim(); this.touch();
  }
  read(generation, after) {
    if (!Number.isSafeInteger(generation) || !Number.isSafeInteger(after) || after < 0) throw Error('表示位置が不正です。');
    const reset = generation !== this.generation || after > this.revision;
    const candidates = this.entries.filter(entry => reset || entry.revision > after).sort((a, b) => a.revision - b.revision);
    const result = {
      generation: this.generation, reset, state: this.state, detail: this.detail,
      sessionNotice: this.sessionNotice || '', canStartNew: this.state === 'error',
      usage: this.pause ? { pauseId: this.pause.id, kind: this.pause.kind, canContinue: this.pause.canContinue, ...(this.usage || { status: 'unknown', windows: [], nextReset: null }), checking: !!this.usageOperation } : null,
      contextRecovery: this.contextRecovery,
      replyOmitted: this.entries.some(entry => entry.truncated),
      canRestoreWithoutHistory: this.state === 'error' && this.canRestoreWithoutHistory, historyNotice: this.historyNotice,
      displayMode: this.settings.displayMode,
      wireLogEnabled: this.settings.wireLogEnabled,
      diagnosticsOmitted: { detail: this.diagnostics.detail.omitted, trace: this.diagnostics.trace.omitted },
      sendKey: this.settings.sendKey,
      settingsPending: !!this.threadOptions && JSON.stringify(this.threadOptions) !== JSON.stringify(startupOptions(this.settings)),
      models: this.models, selection: this.selection, approvalMode: this.approvalMode, approvalModes: modes, saving: this.saving,
      requests: [...this.requests.values()].map(request => request.view),
      entries: [], after: reset ? 0 : after, more: false,
      minOrder: this.entries[0]?.order || 0, omitted: !!this.omitted,
      minOrders: Object.fromEntries(['message', 'detail', 'trace'].map(kind => [kind, this.entries.find(entry => (entry.kind || 'message') === kind)?.order || this.order + 1])),
    };
    let bytes = Buffer.byteLength(JSON.stringify(result));
    for (const entry of candidates) {
      const addition = Buffer.byteLength(JSON.stringify(entry)) + 1;
      if (bytes + addition > 240 * 1024) { result.more = true; break; }
      result.entries.push(entry);
      result.after = entry.revision;
      bytes += addition;
    }
    return structuredClone(result);
  }
  assertGeneration(generation) {
    if (this.closed || generation !== this.generation) throw Error('会話が切り替わりました。表示を更新してください。');
  }
  connect(generation, withoutHistory = false) {
    this.assertGeneration(generation);
    if (withoutHistory && (!this.canRestoreWithoutHistory || this.state !== 'error')) throw Error('会話の復元状態を確認してください。');
    if (busy.has(this.state) || this.state === 'idle') return { accepted: true };
    const epoch = ++this.generation;
    this.connectionEpoch = epoch;
    this.entries = []; this.items = new Map(); this.requests.clear(); this.accepted.clear();
    this.threadOptions = null; this.threadContext = null; this.resetDiagnostics();
    this.threadId = null; this.threadDefaults = null; this.run = null; this.omitted = false; this.models = [];
    this.session = null; this.sessionNotice = ''; this.preferenceWarning = '';
    this.pause = null; this.usage = null; this.usageOperation = null;
    this.contextRecovery = null; this.compactAccepted.clear(); this.nextCwd = null;
    this.canRestoreWithoutHistory = false; this.historyNotice = '';
    this.state = 'connecting'; this.detail = 'Codexに接続しています。'; this.touch();
    void this.connectAsync(epoch, withoutHistory);
    return { accepted: true };
  }
  async connectAsync(epoch, withoutHistory) {
    let client;
    try {
      await this.client?.close();
      let saved;
      try { saved = await this.storage.get('preferences'); } catch { this.preferenceWarning = '保存した選択を読み取れません。選び直して保存してください。'; }
      if (saved != null && (!object(saved) || saved.schemaVersion !== 1 || typeof saved.model !== 'string' || typeof saved.effort !== 'string'))
        this.preferenceWarning = '保存した選択の形式に対応していません。選び直して保存してください。';
      else if (saved) {
        this.selection = { model: saved.model, effort: saved.effort };
        this.approvalMode = saved.approvalMode === undefined ? 'inherit' : validMode(saved.approvalMode) ? saved.approvalMode : '';
        if (!this.approvalMode) this.preferenceWarning = '保存した承認モードに対応していません。選び直してください。';
      }
      const info = await this.getHostInfo();
      if (typeof info?.instanceId !== 'string') throw Error('起動元AppDockの情報を取得できません。Appletの情報取得許可を確認してください。');
      this.hostInstanceId = info.instanceId;
      if (this.closed || epoch !== this.generation) return;
      client = this.clientFactory(); this.client = client;
      client.on('wire', event => {
        if (epoch === this.connectionEpoch && !this.closed && this.settings.wireLogEnabled) {
          try { this.diagnostic('trace', event.direction + ' · ' + (event.method || '応答'), wireView(event)); } catch {}
        }
      });
      client.on('notification', msg => {
        if (epoch === this.connectionEpoch && !this.closed) {
          try { this.notification(msg); } catch { this.disconnected('Codexの通知形式に対応していません。'); }
        }
      });
      client.on('request', msg => {
        if (epoch === this.connectionEpoch && !this.closed) {
          try { this.serverRequest(msg); } catch { try { client.unsupported(msg.id); } catch {} }
        }
      });
      client.on('closed', message => { if (epoch === this.connectionEpoch && !this.closed) this.disconnected(message); });
      await client.start();
      const account = await client.request('account/read', { refreshToken: false });
      if (!account?.account && account?.requiresOpenaiAuth !== false) throw Error('Codexにログインしてください。通常のターミナルで codex を起動して認証を確認してください。');
      const models = [];
      let cursor = null;
      const cursors = new Set();
      do {
        const result = await client.request('model/list', { cursor, limit: 100, includeHidden: false });
        models.push(...modelsFrom(result?.data));
        cursor = result?.nextCursor || null;
        if (cursor && (cursors.has(cursor) || models.length > 1000)) throw Error('Codexのモデル一覧が上限を超えました。');
        cursors.add(cursor);
      } while (cursor);
      if (!models.length) throw Error('利用できるCodexモデルがありません。');
      if (Buffer.byteLength(JSON.stringify(models)) > 128 * 1024) throw Error('Codexのモデル一覧が表示上限を超えました。');
      if (this.closed || epoch !== this.generation) { await client.close(); return; }
      this.models = models;
      if (!this.selection.model) {
        const defaults = models.filter(model => model.isDefault);
        if (defaults.length === 1) this.selection = { model: defaults[0].model, effort: this.defaultEffort(defaults[0]) };
      }
      const savedSession = await this.sessions.load();
      if (this.closed || epoch !== this.generation) return;
      if (savedSession) await this.restore(savedSession, epoch, withoutHistory);
      if (this.closed || epoch !== this.generation) return;
      this.state = 'idle';
      this.detail = this.preferenceWarning || (this.validSelection() ? '' : '利用できるモデルと思考量を選んでください。');
      this.touch();
      if (this.pause) this.checkUsage(this.generation);
    } catch (error) {
      await client?.close();
      if (!this.closed && epoch === this.generation) {
        const alreadyFailed = this.state === 'error';
        this.state = 'error';
        // Host and filesystem exceptions can contain local paths. Only our bounded messages are shown.
        this.detail = error.message?.startsWith('Codex') || error.message?.startsWith('保存') || error.message?.startsWith('利用') || error.message?.startsWith('起動元')
          ? short(error.message) : 'Codexへの接続に失敗しました。通常のターミナルでの起動とAppletの情報取得許可を確認してください。';
        if (!alreadyFailed) Promise.resolve(this.failed('Codexへの接続に失敗しました。チャット画面で接続状態を確認してください。')).catch(() => {});
        this.touch();
      }
    }
  }
  operationInstructions(options) {
    return options.sendOperationInstructions ? 'AppDockの操作を支援するチャットです。設定の操作には既存のAppDock MCPだけを使い、settings.jsonを直接編集しないでください。対象instanceIdは ' +
      this.hostInstanceId + ' です。MCPの情報取得で一致を確認してから操作してください。一致する接続がなければ操作せず説明してください。設定・コマンドのスキーマと現在のrevisionを取得し、必要なdryRun、保存、結果確認を行ってください。失敗・結果不明の操作を自動再送しないでください。' : undefined;
  }
  async restore(session, epoch, withoutHistory = false) {
    this.detail = '最後のチャットを復元しています。'; this.touch();
    if (session.scope !== scopeFor(this.client.env)) throw Error('保存した会話のCodex保存先が現在と異なります。「新しいチャット」で開始し直せます。');
    const developerInstructions = this.operationInstructions(session.options);
    let response, history;
    try {
      response = await this.client.request('thread/resume', { threadId: session.threadId, cwd: session.cwd, excludeTurns: true,
        ...threadConfig(session.options), ...(developerInstructions ? { developerInstructions } : {}) });
      if (response?.thread?.id !== session.threadId || response.thread.ephemeral || response.cwd !== session.cwd || response.thread.status?.type !== 'idle')
        throw Error('Unexpected resume state');
    } catch { throw Error('保存したチャットを復元できません。Codexの履歴・対応版を確認して再接続するか、「新しいチャット」で開始し直してください。自動再送していません。'); }
    if (this.closed || epoch !== this.generation) return;
    history = { turns: [], omitted: true, unavailable: true };
    if (!withoutHistory) {
      try { history = await readHistory(this.client, session.threadId, () => !this.closed && epoch === this.generation); }
      catch {
        if (this.closed || epoch !== this.generation) return;
        if (this.client.closed) {
          this.canRestoreWithoutHistory = true;
          throw Error('保存した会話の履歴表示を読み込めませんでした。履歴の表示を省略して復元するか、再接続してください。自動再送していません。');
        }
      }
    }
    if (this.closed || epoch !== this.generation) return;
    this.threadId = session.threadId; this.threadDefaults = session.defaults; this.threadOptions = session.options;
    this.session = session;
    this.pause = session.pause || null;
    this.contextRecovery = session.contextRecovery ? structuredClone(session.contextRecovery) : null;
    if (this.contextRecovery?.status === 'compacting') this.contextRecovery.status = 'unknown';
    this.threadContext = { operationInstructions: developerInstructions || 'Appletの操作指示は送信していません。', memoryMode: session.options.memoryMode,
      instructionSources: response.instructionSources || [], note: '保存した会話を再開しました。Codex内部の指示全文・メモリ本文は取得していません。' };
    this.diagnostic('detail', '会話の復元', { ...this.threadContext, cwd: session.cwd, ...session.defaults });
    for (const turn of history.turns) for (const item of turn.items) {
      if (item.type === 'userMessage' && Array.isArray(item.content)) {
        const text = item.content.map(part => part.type === 'text' && typeof part.text === 'string' ? part.text : '[添付データ]').join('\n');
        this.entry('user', text);
      } else if (item.type === 'agentMessage' && typeof item.text === 'string') {
        const shown = replyText(item.text), parts = this.entry('assistant', shown);
        if (item.truncated || shown.length < item.text.length) parts.at(-1).truncated = true;
      }
    }
    this.omitted ||= history.omitted;
    this.historyNotice = history.unavailable ? '会話は復元しましたが、過去のメッセージの表示を省略しています。操作結果を確認してから続きを送信してください。' : '';
    const lastStatus = history.lastStatus ?? history.turns.at(-1)?.status;
    const uncertain = history.unavailable || session.inFlight || lastStatus && !['completed', 'failed', 'interrupted'].includes(lastStatus);
    this.sessionNotice = uncertain
      ? '最後のチャットを復元しました。前回の処理は途中で終了した可能性があります。操作結果を確認してから続きを送信してください。自動再送していません。'
      : ['failed', 'interrupted'].includes(lastStatus)
        ? '最後のチャットを復元しました。前回の処理は停止または失敗しています。操作結果を確認してから続きを送信してください。'
        : '最後のチャットを復元しました。そのまま続きを送信できます。';
    if (this.pause) this.sessionNotice = '最後のチャットを復元しました。利用制限で停止した作業があります。';
    else if (this.contextRecovery) this.sessionNotice = '最後のチャットを復元しました。長くなった会話の復旧状態を引き継いでいます。';
  }
  compact(generation, requestId, recoveryId) {
    this.assertGeneration(generation);
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) throw Error('送信IDが不正です。');
    if (this.compactAccepted.has(requestId)) {
      if (this.compactAccepted.get(requestId) !== recoveryId) throw Error('同じ送信IDを別の操作には使えません。');
      return { accepted: true };
    }
    if (recoveryId !== this.contextRecovery?.id || this.contextRecovery.status === 'ready' || this.state !== 'idle' || this.saving || this.usageOperation || !this.threadId)
      throw Error('停止した会話と接続状態を確認してください。');
    this.compactAccepted.set(requestId, recoveryId);
    if (this.compactAccepted.size > 128) this.compactAccepted.delete(this.compactAccepted.keys().next().value);
    const run = { kind: 'compact', generation, canceled: false, interrupted: false, compacted: false };
    this.run = run; this.state = 'compacting'; this.detail = 'Codexで会話を圧縮しています。'; this.touch();
    void this.generateCompact(run);
    return { accepted: true };
  }
  async generateCompact(run) {
    try {
      if (this.pause) {
        let response;
        try { response = await this.client.request('account/rateLimits/read', {}, 10000); }
        catch {
          if (!this.closed && this.run === run) { clearTimeout(this.stopTimer); this.usage = { status: 'unavailable', windows: [], nextReset: null }; this.run = null; this.state = 'idle'; this.touch(); }
          return;
        }
        if (this.closed || this.run !== run) return;
        this.usage = usageSnapshot(response);
        if (this.usage.status !== 'available') { clearTimeout(this.stopTimer); this.run = null; this.state = 'idle'; this.detail = '利用状況を確認してから、会話の圧縮を再開してください。'; this.touch(); return; }
        this.pause = null; if (this.session) delete this.session.pause;
      }
      this.contextRecovery.status = 'compacting';
      if (this.session) {
        this.session.contextRecovery = structuredClone(this.contextRecovery); this.session.inFlight = true;
        await this.sessions.save(this.session);
      }
      if (this.closed || this.run !== run) return;
      if (run.canceled) { await this.finish('interrupted'); return; }
      this.compactTimer = setTimeout(() => { if (this.run === run) this.disconnected('会話の圧縮完了を確認できません。再接続して状態を確認してください。自動でやり直していません。'); }, 300000);
      this.compactTimer.unref?.();
      await this.client.request('thread/compact/start', { threadId: this.threadId });
    } catch (error) {
      if (this.closed || this.run !== run) return;
      if (error.message?.startsWith('保存領域')) this.disconnected(error.message);
      else if (error.code !== undefined) await this.finish('failed', error);
      else this.disconnected('会話の圧縮結果を確認できません。再接続して状態を確認してください。自動でやり直していません。');
    }
  }
  continueContext(generation, requestId, recoveryId) {
    this.assertGeneration(generation);
    const fingerprint = createHash('sha256').update(contextContinuation).digest('hex');
    if (this.accepted.get(requestId) === fingerprint) return { accepted: true };
    if (this.contextRecovery?.id !== recoveryId || this.contextRecovery.status !== 'ready' || !this.contextRecovery.canContinue || this.pause)
      throw Error('会話の圧縮が完了したことと停止した作業を確認してください。');
    return this.send(generation, requestId, contextContinuation);
  }
  async handoff(generation, recoveryId) {
    this.assertGeneration(generation);
    if (this.contextRecovery?.id !== recoveryId || this.state !== 'idle' || this.saving || this.usageOperation) throw Error('停止した会話の待機中に引き継いでください。');
    const cwd = this.session?.cwd || process.cwd(), draft = handoffDraft(this.entries, cwd);
    await this.newChat(generation, true);
    this.nextCwd = cwd; this.detail = '引き継ぎ下書きを確認・補足して送信してください。';
    this.sessionNotice = '送信するまでは、元の会話を再開先として保持します。'; this.touch();
    return { draft };
  }
  checkUsage(generation) {
    this.assertGeneration(generation);
    if (this.usageOperation) return { accepted: true };
    if (this.state !== 'idle' || this.saving || !this.pause) throw Error('利用制限で停止した会話の待機中に確認してください。');
    this.startUsageCheck(generation);
    return { accepted: true };
  }
  resumeWork(generation, requestId, pauseId) {
    this.assertGeneration(generation);
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) throw Error('送信IDが不正です。');
    const fingerprint = createHash('sha256').update(continuation).digest('hex');
    if (this.accepted.get(requestId) === fingerprint) return { accepted: true };
    if (this.accepted.has(requestId)) throw Error('同じ送信IDを別の操作には使えません。');
    if (pauseId !== this.pause?.id) throw Error('停止した作業が切り替わりました。表示を確認してください。');
    if (this.contextRecovery) throw Error('利用可能になったら、先に会話を圧縮してください。');
    if (this.usageOperation?.requestId === requestId) return { accepted: true };
    if (this.state !== 'idle' || this.saving || this.usageOperation || !this.pause?.canContinue || !this.threadId || !this.validSelection())
      throw Error('接続・モデル・停止した会話を確認してください。');
    this.startUsageCheck(generation, requestId);
    return { accepted: true };
  }
  startUsageCheck(generation, requestId) {
    const operation = { generation, pauseId: this.pause.id, requestId };
    this.usageOperation = operation; this.touch();
    void this.queryUsage(operation);
  }
  async queryUsage(operation) {
    const current = () => !this.closed && operation === this.usageOperation && operation.generation === this.generation && operation.pauseId === this.pause?.id && this.state === 'idle';
    try {
      const response = await this.client.request('account/rateLimits/read', {}, 10000);
      if (current()) this.usage = usageSnapshot(response);
    } catch {
      if (current()) this.usage = { status: 'unavailable', windows: [], nextReset: null };
    }
    if (!current()) { if (this.usageOperation === operation) { this.usageOperation = null; this.touch(); } return; }
    this.usageOperation = null;
    if (operation.requestId && this.usage.status === 'available') {
      try { this.send(operation.generation, operation.requestId, continuation); }
      catch { this.usage.note = '再開できませんでした。接続とモデルの選択を確認してください。'; }
    }
    this.touch();
  }
  defaultEffort(model) { return model.efforts.includes(model.defaultEffort) ? model.defaultEffort : ''; }
  validSelection() {
    const model = this.models.find(model => model.model === this.selection.model);
    return validMode(this.approvalMode) && model && (!model.efforts.length || model.efforts.includes(this.selection.effort));
  }
  async select(generation, model, effort) {
    this.assertGeneration(generation);
    if (this.state !== 'idle' || this.saving || this.usageOperation) throw Error('待機中にモデルと思考量を選んでください。');
    const definition = this.models.find(item => item.model === model);
    if (!definition || (definition.efforts.length ? !definition.efforts.includes(effort) : effort !== ''))
      throw Error('このモデルで利用できる思考量を選んでください。');
    this.saving = true; this.touch();
    try {
      if (!validMode(this.approvalMode)) throw Error('承認モードを選んでください。');
      await this.storage.set('preferences', { schemaVersion: 1, model, effort, approvalMode: this.approvalMode });
      this.assertGeneration(generation);
      this.selection = { model, effort }; this.preferenceWarning = ''; this.detail = '';
    } finally { this.saving = false; this.touch(); }
    return { saved: true };
  }
  async selectApproval(generation, mode) {
    this.assertGeneration(generation);
    if (this.state !== 'idle' || this.saving || this.usageOperation) throw Error('待機中に承認モードを選んでください。');
    if (!validMode(mode)) throw Error('承認モードが不正です。');
    this.saving = true; this.touch();
    try {
      await this.storage.set('preferences', { schemaVersion: 1, ...this.selection, approvalMode: mode });
      this.assertGeneration(generation);
      this.approvalMode = mode; this.preferenceWarning = ''; this.detail = '';
    } finally { this.saving = false; this.touch(); }
    return { saved: true };
  }
  send(generation, requestId, text) {
    this.assertGeneration(generation);
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId) || typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > textLimit)
      throw Error('空でない32KiB以下のメッセージを入力してください。');
    const fingerprint = createHash('sha256').update(text).digest('hex');
    const prior = this.accepted.get(requestId);
    if (prior) { if (prior !== fingerprint) throw Error('同じ送信IDを別の文章には使えません。'); return { accepted: true }; }
    if (this.state !== 'idle' || this.saving || this.usageOperation || !this.validSelection()) throw Error('接続とモデル・思考量の選択を確認してください。');
    this.accepted.set(requestId, fingerprint);
    if (this.accepted.size > 128) this.accepted.delete(this.accepted.keys().next().value);
    this.entry('user', text);
    if ((this.pause || this.contextRecovery) && this.sessionNotice) this.sessionNotice = '最後のチャットを復元しました。';
    this.pause = null; this.usage = null;
    if (this.session) delete this.session.pause;
    this.contextRecovery = null;
    if (this.session) delete this.session.contextRecovery;
    this.state = 'running'; this.detail = '応答を生成しています。';
    this.items = new Map();
    const run = { generation, canceled: false, interrupted: false, selection: { ...this.selection }, approvalMode: this.approvalMode };
    this.run = run; this.touch();
    void this.generate(run, text);
    return { accepted: true };
  }
  async generate(run, text) {
    try {
      if (!this.threadId) {
        this.threadOptions = startupOptions(this.settings);
        const developerInstructions = this.operationInstructions(this.threadOptions);
        const start = {
          model: run.selection.model, cwd: this.nextCwd || process.cwd(), serviceName: 'appdock_chatcodex',
          ...threadConfig(this.threadOptions), ...(developerInstructions ? { developerInstructions } : {}),
        };
        this.threadContext = { operationInstructions: developerInstructions || 'Appletの操作指示は送信していません。', memoryMode: this.threadOptions.memoryMode,
          note: 'MEMORY_SUMMARY本文・Codex内部の指示全文は取得していません。メモリ機能の有効状態はCodex設定に従います。' };
        this.diagnostic('detail', 'Appletが送る開始時の指示・設定', { ...this.threadContext, model: start.model, cwd: start.cwd, config: start.config });
        const result = await this.client.request('thread/start', start);
        if (this.run !== run) return;
        if (!result?.thread?.id) throw Error('Codexの会話開始応答に対応していません。');
        this.threadDefaults = threadDefaults(result);
        this.threadContext.instructionSources = Array.isArray(result.instructionSources) ? result.instructionSources : [];
        this.diagnostic('detail', 'Codexが返した開始時の情報', { instructionSources: this.threadContext.instructionSources, ...this.threadDefaults });
        this.threadId = result.thread.id;
        this.nextCwd = null;
        if (result.thread.ephemeral !== true) this.session = {
          schemaVersion: 1, threadId: this.threadId, cwd: result.cwd || start.cwd, scope: scopeFor(this.client.env),
          options: structuredClone(this.threadOptions), defaults: structuredClone(this.threadDefaults), inFlight: false,
        };
      }
      if (run.canceled) { this.finish('interrupted'); return; }
      if (this.session) {
        this.session.inFlight = true;
        await this.sessions.save(this.session);
        if (this.run !== run || this.closed) return;
        if (run.canceled) { this.finish('interrupted'); return; }
      }
      const params = { threadId: this.threadId, input: [{ type: 'text', text }], model: run.selection.model,
        ...turnPolicy(run.approvalMode, this.threadDefaults) };
      if (run.selection.effort) params.effort = run.selection.effort;
      this.diagnostic('detail', '今回の送信設定', { model: params.model, effort: params.effort || '指定なし', approvalMode: run.approvalMode, ...turnPolicy(run.approvalMode, this.threadDefaults) });
      const result = await this.client.request('turn/start', params);
      if (this.run !== run) return;
      if (!result?.turn?.id) throw Error('Codexの送信応答に対応していません。');
      run.turnId = result.turn.id;
      if (run.canceled) this.interrupt(run);
    } catch (error) {
      if (this.run !== run) return;
      if (error.message?.startsWith('保存領域')) { this.disconnected(error.message); return; }
      if (error.code !== undefined || error.message?.startsWith('Codexの承認設定')) {
        await this.finish('failed', error);
        if (this.closed || this.state === 'error') return;
        if (this.pause || this.contextRecovery) return;
        this.detail = error.message?.startsWith('Codexの承認設定') ? error.message
          : 'Codexが送信を受け付けませんでした。承認モード・開始時の設定とCodex側の制限を確認してください。自動再送していません。';
        this.touch();
      } else this.disconnected('Codexへの送信結果を確認できません。操作済みの可能性があるため、自動再送していません。');
    }
  }
  notification({ method, params: p = {} }) {
    if (method === 'account/rateLimits/updated') {
      if (this.pause && !this.usageOperation) {
        try { this.usage = usageSnapshot(p); } catch { this.usage = { status: 'unknown', windows: [], nextReset: null }; }
        this.touch();
      }
      return;
    }
    if (p.threadId && p.threadId !== this.threadId) return;
    if (method === 'serverRequest/resolved') {
      for (const [id, request] of this.requests) if (request.wireId === p.requestId) this.requests.delete(id);
      if (this.run && this.state !== 'stopping') this.state = this.requests.size ? 'awaitingInput' : 'running';
      this.touch(); return;
    }
    if (!this.run) return;
    if (this.run.kind === 'compact' && !this.run.turnId && method !== 'turn/started') return;
    const eventTurnId = p.turnId || p.turn?.id;
    if (eventTurnId && this.run.turnId && eventTurnId !== this.run.turnId) return;
    if (['item/started', 'item/completed'].includes(method) && p.item && !['agentMessage', 'reasoning', 'userMessage'].includes(p.item.type))
      this.diagnostic('detail', (method === 'item/started' ? '開始' : '完了') + ' · ' + p.item.type, p.item);
    if (method === 'error') { this.run.limit = limitReason(p.error); this.run.contextLimit = isContextLimit(p.error); this.diagnostic('detail', 'Codexのエラー', p.error || p); }
    if (method === 'turn/started') {
      if (p.turn?.id) this.run.turnId = p.turn.id;
      if (this.run.canceled) this.interrupt(this.run);
    } else if (method === 'item/completed' && p.item?.type === 'contextCompaction' && this.run.kind === 'compact') {
      this.run.compacted = true; this.detail = '会話の圧縮結果を確認しています。'; this.touch();
    } else if (this.run.kind === 'compact' && ['item/agentMessage/delta', 'item/completed'].includes(method)) {
      // Compaction summaries are not ordinary assistant replies.
    } else if (method === 'item/agentMessage/delta') {
      if (typeof p.itemId === 'string' && typeof p.delta === 'string') this.append(p.itemId, p.delta);
    } else if (method === 'item/completed' && p.item?.type === 'agentMessage') {
      const id = p.item.id;
      const original = typeof p.item.text === 'string' ? p.item.text : '', text = replyText(original);
      let item = this.items.get(id);
      if (!item) { item = { id, parts: this.entry('assistant', '', id) }; this.items.set(id, item); }
      const count = Math.max(1, Math.ceil(text.length / 4096));
      while (item.parts.length < count) {
        const part = this.entry('assistant', '', id + ':part:' + item.parts.length)[0];
        part.id = id + ':' + item.parts.length * 4096; part.messageId = id; item.parts.push(part);
      }
      item.parts.forEach((part, index) => { part.text = text.slice(index * 4096, (index + 1) * 4096); part.revision = ++this.revision; delete part.active; delete part.truncated; });
      item.length = text.length; item.completed = true;
      if (text.length < original.length) item.parts.at(-1).truncated = true;
      this.touch();
    } else if (method === 'item/started' && p.item?.type === 'mcpToolCall') {
      this.detail = 'MCPの操作を実行しています。'; this.touch();
    } else if (method === 'turn/completed') this.finish(p.turn?.status || 'completed', p.turn?.error);
    else if (method === 'error') { this.detail = 'Codexでエラーが発生しました。'; this.touch(); }
  }
  async finish(status, error) {
    if (!this.run) return;
    const compact = this.run.kind === 'compact', compacted = compact && status === 'completed' && this.run.compacted && !this.run.canceled;
    const contextLimit = status === 'failed' && (error?.codexErrorInfo != null ? isContextLimit(error) : this.run.contextLimit);
    if (compact) {
      this.contextRecovery.status = compacted ? 'ready' : status === 'interrupted' ? 'needed' : 'failed';
    } else if (contextLimit) this.contextRecovery = { id: randomUUID(), status: 'needed', stoppedAt: Date.now(), canContinue: !!this.run.turnId };
    if (this.session && this.contextRecovery) this.session.contextRecovery = structuredClone(this.contextRecovery);
    const kind = status === 'failed' ? error?.codexErrorInfo != null ? limitReason(error) : this.run.limit : null;
    if (kind) {
      this.pause = { id: randomUUID(), kind, stoppedAt: Date.now(), canContinue: !!this.run.turnId };
      this.usage = null;
      if (this.session) this.session.pause = structuredClone(this.pause);
    }
    clearTimeout(this.stopTimer);
    clearTimeout(this.compactTimer);
    for (const entry of this.entries) delete entry.active;
    this.run = null; this.requests.clear(); this.state = 'saving'; this.touch();
    const generation = this.generation;
    try {
      if (this.session) { this.session.inFlight = false; await this.sessions.save(this.session); }
    } catch (error) {
      if (!this.closed && generation === this.generation) this.disconnected(error.message);
      return;
    }
    if (this.closed || generation !== this.generation) return;
    this.state = 'idle';
    this.detail = this.pause ? this.pause.kind === 'usage' ? 'Codexの利用制限のため停止しました。' : 'Codexの一時的な送信制限のため停止しました。'
      : this.contextRecovery ? this.contextRecovery.status === 'ready' ? '会話の圧縮が完了しました。作業を再開できます。'
        : '会話の長さの上限で停止しています。圧縮または新しいチャットへの引き継ぎを選べます。'
      : status === 'interrupted' ? '停止しました。送信済みの操作は取り消されない場合があります。'
      : status === 'failed' ? 'Codexの処理に失敗しました。結果を確認してください。' : '';
    if (status === 'failed') Promise.resolve(this.failed(this.detail)).catch(() => {});
    this.trim(); this.touch();
    if (this.pause) this.checkUsage(this.generation);
  }
  cancelRequests() {
    for (const request of this.requests.values()) {
      try { this.client.respond(request.wireId, request.cancel); } catch {}
    }
    this.requests.clear();
  }
  stop(generation) {
    this.assertGeneration(generation);
    if (!this.run) return { accepted: true };
    this.run.canceled = true; this.state = 'stopping'; this.detail = '停止しています。';
    this.cancelRequests(); this.interrupt(this.run); this.touch();
    if (this.run?.kind === 'compact' && !this.run.turnId) {
      const run = this.run;
      this.stopTimer = setTimeout(() => { if (this.run === run) this.disconnected('圧縮の停止結果を確認できません。再接続して状態を確認してください。'); }, 15000);
      this.stopTimer.unref?.();
    }
    return { accepted: true };
  }
  interrupt(run) {
    if (!run.turnId || run.interrupted) return;
    run.interrupted = true;
    clearTimeout(this.stopTimer);
    void this.client.request('turn/interrupt', { threadId: this.threadId, turnId: run.turnId }, 10000)
      .catch(() => { if (this.run === run) this.disconnected('停止の結果を確認できません。接続し直す前に操作結果を確認してください。'); });
    this.stopTimer = setTimeout(() => {
      if (this.run === run) this.disconnected('停止完了を確認できません。操作結果を確認してください。');
    }, 15000);
    this.stopTimer.unref?.();
  }
  async newChat(generation, preservePrevious = false) {
    this.assertGeneration(generation);
    if (!['idle', 'error'].includes(this.state) || this.saving || this.usageOperation) throw Error('待機中に新しいチャットを開始してください。');
    this.saving = true; this.touch();
    try { if (!preservePrevious) await this.sessions.save(null); this.assertGeneration(generation); }
    finally { this.saving = false; this.touch(); }
    const reconnect = this.state === 'error';
    this.generation++; this.entries = []; this.items = new Map(); this.accepted.clear(); this.requests.clear();
    this.threadOptions = null; this.threadContext = null; this.resetDiagnostics();
    this.threadId = null; this.threadDefaults = null; this.detail = ''; this.omitted = false; this.touch();
    this.session = null; this.sessionNotice = '';
    this.pause = null; this.usage = null; this.usageOperation = null;
    this.contextRecovery = null; this.compactAccepted.clear(); this.nextCwd = null;
    this.canRestoreWithoutHistory = false; this.historyNotice = '';
    if (reconnect) { this.state = 'disconnected'; this.connect(this.generation); }
    return { accepted: true };
  }
  disconnected(message) {
    const alreadyFailed = this.state === 'error';
    this.cancelRequests();
    this.run = null;
    if (this.contextRecovery?.status === 'compacting') this.contextRecovery.status = 'unknown';
    for (const entry of this.entries) delete entry.active;
    this.state = 'error'; this.detail = message; this.touch();
    if (!alreadyFailed) Promise.resolve(this.failed('Codexとの通信が終了しました。チャット画面で処理結果を確認してください。')).catch(() => {});
    void this.client?.close();
  }
  serverRequest(msg) {
    const p = msg.params || {};
    if (this.run?.kind === 'compact') { this.client.unsupported(msg.id); return; }
    if (!this.run || (p.threadId && p.threadId !== this.threadId) || this.requests.size >= 4 || Buffer.byteLength(JSON.stringify(p)) > 16384) {
      this.client.unsupported(msg.id); return;
    }
    const id = randomUUID();
    this.diagnostic('detail', 'Codexからの確認要求 · ' + msg.method, p);
    let view, cancel, accept;
    if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(msg.method)) {
      const available = Array.isArray(p.availableDecisions) ? p.availableDecisions : ['accept', 'decline', 'cancel'];
      const choices = ['accept', 'decline', 'cancel'].filter(value => available.includes(value));
      if (!choices.length) { this.client.unsupported(msg.id); return; }
      view = { id, kind: 'approval', title: 'Codexからの実行確認', detail: short(p.reason || p.command || 'この操作を許可しますか？'), choices };
      cancel = { decision: choices.includes('cancel') ? 'cancel' : 'decline' };
      accept = answer => { if (!choices.includes(answer.decision)) throw Error('確認の選択肢が不正です。'); return { decision: answer.decision }; };
    } else if (msg.method === 'item/permissions/requestApproval') {
      view = { id, kind: 'approval', title: 'Codexからの権限確認', detail: short(p.reason || JSON.stringify(p.permissions)), choices: ['accept', 'decline'] };
      cancel = { permissions: {}, scope: 'turn' };
      accept = answer => { if (!['accept', 'decline'].includes(answer.decision)) throw Error('確認の選択肢が不正です。'); return answer.decision === 'accept' ? { permissions: p.permissions || {}, scope: 'turn' } : cancel; };
    } else if (msg.method === 'item/tool/requestUserInput' && Array.isArray(p.questions) && p.questions.length <= 3) {
      const questions = p.questions.map(q => ({
        id: short(q.id, 100), title: short(q.question, 3000),
        options: Array.isArray(q.options) ? q.options.slice(0, 20).map(option => ({ label: short(option.label, 200), description: short(option.description, 500) })) : [],
        other: q.isOther === true,
      }));
      if (questions.some(q => !q.id || !q.title)) { this.client.unsupported(msg.id); return; }
      view = { id, kind: 'questions', title: 'Codexからの質問', questions };
      cancel = { answers: {} };
      accept = answer => {
        if (!object(answer.answers)) throw Error('質問への回答が不正です。');
        const answers = Object.create(null);
        for (const q of questions) {
          const value = answer.answers[q.id];
          if (typeof value !== 'string' || !value.trim() || value.length > 4000 ||
            (q.options.length && !q.other && !q.options.some(option => option.label === value))) throw Error('質問への回答を確認してください。');
          answers[q.id] = { answers: [value] };
        }
        return { answers };
      };
    } else if (msg.method === 'mcpServer/elicitation/request' && ['form', 'openai/form'].includes(p.mode)) {
      const schema = p.requestedSchema;
      const fields = object(schema?.properties) ? Object.entries(schema.properties) : [];
      if (schema?.type !== 'object' || !object(schema.properties) ||
          (schema.required != null && (!Array.isArray(schema.required) || schema.required.some(key => !Object.hasOwn(schema.properties, key)))) ||
          fields.length > 12 || fields.some(([, field]) => !object(field) || !['string', 'number', 'integer', 'boolean'].includes(field.type) || field.items || field.format === 'password')) {
        this.client.respond(msg.id, { action: 'cancel', content: null });
        this.entry('assistant', 'MCPから届いた確認フォームに対応していないため、確認をキャンセルしました。操作結果を確認してください。'); return;
      }
      if (!fields.length) {
        view = { id, kind: 'approval', title: 'MCPからの確認', detail: short(p.message), choices: ['accept', 'decline', 'cancel'] };
        cancel = { action: 'cancel', content: null };
        accept = answer => {
          if (!['accept', 'decline', 'cancel'].includes(answer.decision)) throw Error('確認の選択肢が不正です。');
          return { action: answer.decision, content: answer.decision === 'accept' ? {} : null };
        };
      } else {
      const questions = fields.map(([key, field]) => ({
        id: key, title: short(field.title || field.description || key, 1000),
        options: Array.isArray(field.enum) ? field.enum.map(value => ({ label: String(value) })) : field.type === 'boolean' ? [{ label: 'true' }, { label: 'false' }] : [],
        other: !field.enum && field.type !== 'boolean',
      }));
      view = { id, kind: 'questions', title: short(p.message) || 'MCPからの確認', questions };
      cancel = { action: 'cancel', content: null };
      accept = answer => {
        if (answer.decision === 'cancel') return cancel;
        if (!object(answer.answers)) throw Error('回答の形式が不正です。');
        const content = Object.create(null);
        for (const [key, field] of fields) {
          const value = answer.answers[key];
          if (typeof value !== 'string' || value.length > 4000) throw Error('回答を確認してください。');
          if (!value && !(schema.required || []).includes(key)) continue;
          const parsed = field.type === 'boolean' ? (value === 'true' ? true : value === 'false' ? false : null)
            : ['number', 'integer'].includes(field.type) ? (value.trim() ? Number(value) : NaN) : value;
          if (parsed === null || (typeof parsed === 'number' && (!Number.isFinite(parsed) || (field.type === 'integer' && !Number.isInteger(parsed)) ||
            (field.minimum !== undefined && parsed < field.minimum) || (field.maximum !== undefined && parsed > field.maximum))) ||
            (typeof parsed === 'string' && ((field.minLength && parsed.length < field.minLength) || (field.maxLength && parsed.length > field.maxLength))) ||
            (field.enum && !field.enum.includes(parsed))) throw Error('回答の値を確認してください。');
          content[key] = parsed;
        }
        return { action: 'accept', content };
      };
      }
    } else if (msg.method === 'mcpServer/elicitation/request') {
      this.client.respond(msg.id, { action: 'cancel', content: null });
      this.entry('assistant', 'この形式のMCP確認には対応していないため、確認をキャンセルしました。操作結果を確認してください。'); return;
    } else {
      this.client.unsupported(msg.id);
      this.detail = 'このCodex確認形式には対応していません。処理を継続できない場合は停止してください。'; this.touch(); return;
    }
    if (Buffer.byteLength(JSON.stringify(view)) > 16384) { this.client.respond(msg.id, cancel); return; }
    this.requests.set(id, { wireId: msg.id, view, cancel, accept });
    this.state = 'awaitingInput'; this.detail = ''; this.touch();
  }
  respond(generation, id, response) {
    this.assertGeneration(generation);
    const request = this.requests.get(id);
    if (!request || !this.run || this.state === 'stopping') throw Error('この確認は終了しています。');
    if (typeof response !== 'string' || Buffer.byteLength(response) > 16384) throw Error('回答が大きすぎます。');
    let answer;
    try { answer = JSON.parse(response); } catch { throw Error('回答の形式が不正です。'); }
    if (!object(answer)) throw Error('回答の形式が不正です。');
    const result = answer.decision === 'cancel' && request.view.kind === 'questions' ? request.cancel : request.accept(answer);
    this.diagnostic('detail', '確認への回答', { kind: request.view.kind, response: result });
    this.client.respond(request.wireId, result);
    this.requests.delete(id);
    this.state = this.requests.size ? 'awaitingInput' : 'running'; this.touch();
    return { accepted: true };
  }
  async close() {
    this.closed = true;
    clearTimeout(this.notifyTimer); clearTimeout(this.stopTimer); clearTimeout(this.compactTimer);
    this.cancelRequests();
    if (this.run?.turnId) {
      try { this.client.send({ id: 'shutdown', method: 'turn/interrupt', params: { threadId: this.threadId, turnId: this.run.turnId } }); } catch {}
    }
    await Promise.allSettled([this.client?.close(), this.sessions.flush()]);
    this.entries = []; this.run = null;
  }
}
module.exports = { Chat, modelsFrom };
