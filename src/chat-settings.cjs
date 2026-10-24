'use strict';
const defaults = { displayMode: 'normal', wireLogEnabled: false, sendKey: 'ctrl-enter', sendOperationInstructions: true, memoryMode: 'inherit' };
const settingKeys = { displayMode: 'chatDisplayMode' };
const settingDefaults = { ...defaults, displayMode: 'inherit' };
function normalizeSettings(value = {}) {
  return {
    displayMode: value.displayMode === 'trace' ? 'detail' : ['normal', 'detail'].includes(value.displayMode) ? value.displayMode : defaults.displayMode,
    wireLogEnabled: typeof value.wireLogEnabled === 'boolean' ? value.wireLogEnabled : defaults.wireLogEnabled,
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
module.exports = { defaults, settingDefaults, settingKeys, normalizeSettings, startupOptions, threadConfig };
