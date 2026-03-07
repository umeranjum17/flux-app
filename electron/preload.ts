import { contextBridge, ipcRenderer } from 'electron';

const listenerMap = new Map<string, Map<(...args: any[]) => void, (...args: any[]) => void>>();

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,

  invoke(channel: string, ...args: any[]): Promise<any> {
    return ipcRenderer.invoke(channel, ...args);
  },

  on(channel: string, callback: (...args: any[]) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, ...args: any[]) => {
      callback(...args);
    };
    if (!listenerMap.has(channel)) {
      listenerMap.set(channel, new Map());
    }
    listenerMap.get(channel)!.set(callback, listener);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
      listenerMap.get(channel)?.delete(callback);
    };
  },

  off(channel: string, callback: (...args: any[]) => void): void {
    const listener = listenerMap.get(channel)?.get(callback) ?? callback;
    ipcRenderer.removeListener(channel, listener);
    listenerMap.get(channel)?.delete(callback);
  },
});
