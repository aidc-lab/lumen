/**
 * preload.js：向渲染进程暴露有限的 Electron 能力（contextIsolation）。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  getSidecarInfo: () => ipcRenderer.invoke('get-sidecar-info'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
})
