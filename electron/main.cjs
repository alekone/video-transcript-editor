const { app, BrowserWindow, dialog, ipcMain, protocol, net } = require("electron");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const ROOT = path.join(__dirname, "..");
// In dev carichiamo il dev server Vite; in prod i file buildati (fase 2).
const DEV_URL = process.env.ELECTRON_RENDERER_URL || "http://localhost:5173/v-editor/";

// Protocollo "media://" per riprodurre video locali (10+ GB) con range request,
// senza caricarli in memoria e senza disabilitare la web security.
protocol.registerSchemesAsPrivileged([
  { scheme: "media", privileges: { stream: true, supportFetchAPI: true, secure: true, bypassCSP: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 850,
    title: "v-editor",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.on("did-finish-load", () => console.log("[main] renderer caricato:", DEV_URL));
  win.webContents.on("did-fail-load", (_e, code, desc) => console.error("[main] load fallito:", code, desc));
  win.loadURL(DEV_URL);
  return win;
}

app.whenReady().then(() => {
  protocol.handle("media", (request) => {
    // media://x<encoded-absolute-path>  →  file://<path> (con range)
    const u = new URL(request.url);
    const filePath = decodeURIComponent(u.pathname);
    return net.fetch(pathToFileURL(filePath).toString(), {
      headers: request.headers,
      method: request.method,
    });
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// --- IPC -----------------------------------------------------------------

ipcMain.handle("open-video", async () => {
  const r = await dialog.showOpenDialog({
    title: "Apri video",
    properties: ["openFile"],
    filters: [{ name: "Video/Audio", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "wav", "mp3", "m4a", "aac"] }],
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

// Lancia la pipeline locale (riusa scripts/transcribe.mjs: ffmpeg + whisper.cpp
// + diarizzazione). Manda l'avanzamento al renderer, ritorna il transcript.
ipcMain.handle("transcribe", async (e, videoPath, opts = {}) => {
  const out = path.join(os.tmpdir(), `vte-${Date.now()}.json`);
  const args = [path.join(ROOT, "scripts", "transcribe.mjs"), videoPath, "--lang", opts.lang || "it", "--out", out];
  const spk = (opts.speakers || "").trim();
  if (spk) args.push("--speakers", spk);

  await new Promise((resolve, reject) => {
    const p = spawn("node", args, { cwd: ROOT });
    const send = (d) => e.sender.send("transcribe-progress", d.toString());
    p.stdout.on("data", send);
    p.stderr.on("data", send);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Trascrizione fallita (codice ${code})`))));
  });

  const data = JSON.parse(fs.readFileSync(out, "utf8"));
  fs.unlinkSync(out);
  return data;
});

ipcMain.handle("save-project", async (e, data, suggestedName) => {
  const r = await dialog.showSaveDialog({ defaultPath: `${suggestedName}.vte.json` });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2));
  return r.filePath;
});

ipcMain.handle("load-project", async () => {
  const r = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Progetto v-editor", extensions: ["json"] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return JSON.parse(fs.readFileSync(r.filePaths[0], "utf8"));
});
