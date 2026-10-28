'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('api', {
  cases: { list: inv('cases:list'), load: inv('cases:load'), save: inv('cases:save'), saveScan: inv('cases:saveScan'), remove: inv('cases:delete') },
  pickFiles: inv('files:pick'),
  openDataFolder: inv('app:openDataFolder'),
  settings: { get: inv('settings:get'), set: inv('settings:set'), setKey: inv('settings:setKey') },
  ai: { run: inv('ai:run'), models: inv('ai:models') },
  makePdf: inv('pdf:make'),
  update: { check: inv('update:check'), download: inv('update:download'), install: inv('update:install'), onStatus: (cb) => ipcRenderer.on('update:status', (e, s) => cb(s)) }
});
