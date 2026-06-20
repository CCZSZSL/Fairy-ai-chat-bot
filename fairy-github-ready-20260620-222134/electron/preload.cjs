const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fairy", {
  loadMessages: () => ipcRenderer.invoke("messages:list"),
  sendChat: (content, context, requestId) => ipcRenderer.invoke("chat:send", { content, context, requestId }),
  saveMessage: (role, content, metadata) => ipcRenderer.invoke("messages:save", { role, content, metadata }),
  loadSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  getMemoryStats: () => ipcRenderer.invoke("memory:stats"),
  exportMemory: () => ipcRenderer.invoke("memory:export"),
  transcribeAudio: (audio, mimeType) => ipcRenderer.invoke("speech:transcribe", { audio, mimeType }),
  synthesizeSpeech: (text) => ipcRenderer.invoke("speech:synthesize", { text }),
  observeScreen: (requestId) => ipcRenderer.invoke("screen:observe", { requestId }),
  cancelRequest: (requestId) => ipcRenderer.invoke("request:cancel", { requestId }),
  onScreenObserved: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on("screen:observed", listener);
    return () => ipcRenderer.removeListener("screen:observed", listener);
  },
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke("window:alwaysOnTop", enabled),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  close: () => ipcRenderer.invoke("window:close"),
});
