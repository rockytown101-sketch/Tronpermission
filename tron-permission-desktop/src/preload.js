const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  createRequest: input => ipcRenderer.invoke('request:create', input),
  listRequests: () => ipcRenderer.invoke('request:list'),
  getRequest: id => ipcRenderer.invoke('request:get', id),
  walletLinks: id => ipcRenderer.invoke('wallet:links', id),
  openWallet: url => ipcRenderer.invoke('wallet:open', { url }),
  settings: () => ipcRenderer.invoke('settings:get')
});
