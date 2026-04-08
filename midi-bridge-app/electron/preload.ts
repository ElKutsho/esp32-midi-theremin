import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // MIDI Output via main process (jzz)
  midi: {
    listOutputs: (): Promise<string[]> => ipcRenderer.invoke('midi:list-outputs'),
    openOutput: (portName: string): Promise<boolean> => ipcRenderer.invoke('midi:open-output', portName),
    closeOutput: (): Promise<void> => ipcRenderer.invoke('midi:close-output'),
    send: (data: number[]): void => ipcRenderer.send('midi:send', data),
  },
});
