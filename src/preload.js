// The island page's only bridge to the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jager', {
  onUi: (cb) => ipcRenderer.on('ui', (_e, payload) => cb(payload)),
  onListen: (cb) => ipcRenderer.on('listen', (_e, payload) => cb(payload)),
  utterance: (mode, pcm) => ipcRenderer.send('utterance', { mode, pcm }),
  listenTimeout: () => ipcRenderer.send('listen-timeout'),
  interactive: (on) => ipcRenderer.send('interactive', Boolean(on)),
  toggle: () => ipcRenderer.send('toggle'),
  cancel: () => ipcRenderer.send('cancel'),
  ready: () => ipcRenderer.send('ready'),
  log: (msg) => ipcRenderer.send('log', String(msg)),
});
