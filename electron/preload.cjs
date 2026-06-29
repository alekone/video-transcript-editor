const { contextBridge, ipcRenderer } = require("electron");

// API esposta al renderer (window.electronAPI). Niente Node diretto nel
// renderer: tutto passa per IPC.
contextBridge.exposeInMainWorld("electronAPI", {
  openVideo: () => ipcRenderer.invoke("open-video"),

  // path assoluto → URL riproducibile dal protocollo custom "media://".
  mediaUrl: (filePath) => `media://x${encodeURI(filePath)}`,

  transcribe: (videoPath, opts) => ipcRenderer.invoke("transcribe", videoPath, opts),

  cachedTranscript: (videoPath) => ipcRenderer.invoke("cached-transcript", videoPath),

  autosaveProject: (name, data) => ipcRenderer.invoke("autosave-project", name, data),
  listProjects: () => ipcRenderer.invoke("list-projects"),
  readProject: (name) => ipcRenderer.invoke("read-project", name),

  saveProject: (data, suggestedName) => ipcRenderer.invoke("save-project", data, suggestedName),
  loadProject: () => ipcRenderer.invoke("load-project"),

  onTranscribeProgress: (cb) => {
    const handler = (_e, line) => cb(line);
    ipcRenderer.on("transcribe-progress", handler);
    return () => ipcRenderer.removeListener("transcribe-progress", handler);
  },
});
