import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  windowDrag: (dx: number, dy: number) => ipcRenderer.send('window-drag', { dx, dy }),
});
