'use strict';
const defaults = { displayMode: 'normal', sendKey: 'ctrl-enter', sendOperationInstructions: true, memoryMode: 'inherit' };
function normalizeSettings(value = {}) {
  return {
    displayMode: ['normal', 'detail', 'trace'].includes(value.displayMode) ? value.displayMode : defaults.displayMode,
    sendKey: ['enter', 'ctrl-enter'].includes(value.sendKey) ? value.sendKey : defaults.sendKey,
    sendOperationInstructions: typeof value.sendOperationInstructions === 'boolean' ? value.sendOperationInstructions : defaults.sendOperationInstructions,
    memoryMode: ['inherit', 'include', 'exclude'].includes(value.memoryMode) ? value.memoryMode : defaults.memoryMode,
  };
}
function startupOptions(settings) {
  return { sendOperationInstructions: settings.sendOperationInstructions, memoryMode: settings.memoryMode };
}
function threadConfig(settings) {
  return settings.memoryMode === 'inherit' ? {} : { config: { 'memories.use_memories': settings.memoryMode === 'include' } };
}
module.exports = { defaults, normalizeSettings, startupOptions, threadConfig };
