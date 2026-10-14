const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
    getAppRole: () => ipcRenderer.invoke('get-app-role'),
    getServerConfig: () => ipcRenderer.invoke('get-server-config'),
    saveServerUrl: (url) => ipcRenderer.invoke('save-server-url', url),
    printReceipt: (htmlData) => ipcRenderer.invoke('print-receipt', htmlData),
    toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen')
});

