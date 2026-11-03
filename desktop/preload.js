const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
    getAppRole: () => ipcRenderer.invoke('get-app-role'),
    getConnectionStatus: () => ipcRenderer.invoke('get-connection-status'),
    chooseServer: id => ipcRenderer.invoke('choose-server', id),
    toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen')
});
