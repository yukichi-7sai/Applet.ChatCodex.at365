'use strict';
const { Chat } = require('./chat.cjs');
const { defaults, settingDefaults, settingKeys } = require('./chat-settings.cjs');

function createApplet(options = {}) {
  let chat, disposeSettings;
  return {
    async activate(context) {
      const readSettings = () => Object.fromEntries(Object.entries(settingDefaults).map(([key, value]) => {
        const selected = context.settings?.get(settingKeys[key] || key, value) ?? value;
        return [key, key === 'displayMode' && selected === 'inherit' ? context.settings?.get(key, defaults.displayMode) ?? defaults.displayMode : selected];
      }));
      chat = new Chat({
        storage: context.storage,
        getHostInfo: () => context.appdock.call('system.getInfo'),
        changed: () => context.pages.notifyChanged('main'),
        failed: message => context.log.error(message),
        settings: readSettings(),
        ...options,
      });
      disposeSettings = context.settings?.onChanged(() => chat?.setSettings(readSettings()));
      context.commands.register('at365.chatcodex.open', 'Codexチャットを開く', () => context.pages.open('main'));
    },
    async onPageAction(id, input, pageId) {
      if (!chat || pageId !== 'main') throw Error('チャットページが利用できません。');
      switch (id) {
        case 'chat.read': return chat.read(input.generation, input.after);
        case 'chat.connect': return chat.connect(input.generation);
        case 'chat.restore-light': return chat.connect(input.generation, true);
        case 'chat.recover': return chat.recover(input.generation, input.requestId, input.recoveryId);
        case 'chat.select': return chat.select(input.generation, input.model, input.effort);
        case 'chat.approval': return chat.selectApproval(input.generation, input.mode);
        case 'chat.send': return chat.send(input.generation, input.requestId, input.text);
        case 'chat.new': return chat.newChat(input.generation);
        case 'chat.stop': return chat.stop(input.generation);
        case 'chat.respond': return chat.respond(input.generation, input.requestId, input.response);
        case 'chat.usage': return chat.checkUsage(input.generation);
        case 'chat.resume': return chat.resumeWork(input.generation, input.requestId, input.pauseId);
        case 'chat.compact': return chat.compact(input.generation, input.requestId, input.recoveryId);
        case 'chat.context-continue': return chat.continueContext(input.generation, input.requestId, input.recoveryId);
        case 'chat.handoff': return chat.handoff(input.generation, input.recoveryId);
        case 'chat.note-save': return chat.saveNote(input.generation, input.threadId, input.noteId, input.requestId, input.text);
        case 'chat.note-handoff': return chat.handoffNote(input.generation, input.threadId, input.noteId);
        default: throw Error('未対応のページ操作です。');
      }
    },
    async deactivate() { disposeSettings?.(); disposeSettings = undefined; await chat?.close(); chat = undefined; },
  };
}
Object.assign(exports, createApplet());
exports.createApplet = createApplet;
