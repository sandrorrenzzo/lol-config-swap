const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  estado: () => ipcRenderer.invoke('estado'),
  salvar: (nome) => ipcRenderer.invoke('salvar', nome),
  aplicar: (nome) => ipcRenderer.invoke('aplicar', nome),
  restaurar: () => ipcRenderer.invoke('restaurar'),
  excluir: (nome) => ipcRenderer.invoke('excluir', nome),
  abrirPasta: () => ipcRenderer.invoke('abrir-pasta'),
});
