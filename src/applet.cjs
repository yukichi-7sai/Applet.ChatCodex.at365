'use strict';
const { Chat } = require('./chat.cjs');

function createApplet(options = {}) {
  let chat;
  return {
    async activate(context) {
      chat = new Chat({
        storage: context.storage,
        getHostInfo: () => context.appdock.call('system.getInfo'),
        changed: () => context.pages.notifyChanged('main'),
        failed: message => context.log.error(message),
        ...options,
      });
      context.commands.register('at365.chatcodex.open', 'Codexチャットを開く', () => context.pages.open('main'));
    },
    async onPageAction(id, input, pageId) {
      if (!chat || pageId !== 'main') throw Error('チャットページが利用できません。');
      switch (id) {
        case 'chat.read': return chat.read(input.generation, input.after);
        case 'chat.connect': return chat.connect(input.generation);
        case 'chat.select': return chat.select(input.generation, input.model, input.effort);
        case 'chat.send': return chat.send(input.generation, input.requestId, input.text);
        case 'chat.new': return chat.newChat(input.generation);
        case 'chat.stop': return chat.stop(input.generation);
        case 'chat.respond': return chat.respond(input.generation, input.requestId, input.response);
        default: throw Error('未対応のページ操作です。');
      }
    },
    async deactivate() { await chat?.close(); chat = undefined; },
  };
}
Object.assign(exports, createApplet());
exports.createApplet = createApplet;
