const { app, BrowserWindow, dialog, ipcMain, protocol, net } = require("electron");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const crypto = require("node:crypto");

const isDev = !app.isPackaged;
const ROOT = path.join(__dirname, "..");
const DEV_URL = process.env.ELECTRON_RENDERER_URL || "http://localhost:5173/v-editor/";

// Diagnostica: invece di crashare in silenzio, logga su file e mostra il
// messaggio. Il log è in ~/Library/Application Support/v-editor/crash.log.
function logCrash(kind, err) {
  const msg = `[${kind}] ${err && err.stack ? err.stack : err}\n`;
  try {
    const dir = app.getPath("userData");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "crash.log"), `${new Date().toISOString()} ${msg}`);
  } catch {}
  try {
    dialog.showErrorBox("v-editor — errore", String(err && err.message ? err.message : err));
  } catch {}
}
process.on("uncaughtException", (e) => logCrash("uncaughtException", e));
process.on("unhandledRejection", (e) => logCrash("unhandledRejection", e));

// PATH di un'app GUI su macOS non include /opt/homebrew/bin: lo aggiungiamo
// così i sottoprocessi trovano ffmpeg / whisper-cli / python.
const BIN_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

// Percorsi delle risorse "engine": in dev stanno nel progetto; nel bundle
// vengono copiate in resources/engine (extraResources).
function enginePaths() {
  const base = isDev ? ROOT : path.join(process.resourcesPath, "engine");
  const userData = app.getPath("userData");
  return {
    transcribeScript: path.join(base, "scripts", "transcribe.mjs"),
    diarizeModels: path.join(base, "models", "diarization"),
    // modelli whisper: cartella scrivibile (auto-download al primo uso)
    whisperModels: isDev ? path.join(ROOT, "models") : path.join(userData, "whisper-models"),
    // python con sherpa-onnx: in dev il venv del progetto, nel bundle in userData
    venvPython: isDev
      ? path.join(ROOT, ".venv", "bin", "python")
      : path.join(userData, "diar-venv", "bin", "python"),
  };
}

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
  win.webContents.on("did-finish-load", () => console.log("[main] renderer caricato"));
  win.webContents.on("did-fail-load", (_e, c, d) => console.error("[main] load fallito:", c, d));
  win.webContents.on("render-process-gone", (_e, details) =>
    logCrash("render-process-gone", `${details.reason} (exitCode ${details.exitCode})`)
  );
  win.webContents.on("unresponsive", () => logCrash("unresponsive", "renderer bloccato"));
  if (isDev) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, "..", "client", "dist-electron", "index.html"));
  return win;
}

app.whenReady().then(() => {
  protocol.handle("media", async (request) => {
    try {
      const u = new URL(request.url);
      const filePath = decodeURIComponent(u.pathname);
      return await net.fetch(pathToFileURL(filePath).toString(), {
        headers: request.headers,
        method: request.method,
      });
    } catch (err) {
      logCrash("media-protocol", err);
      return new Response("", { status: 500 });
    }
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

protocol.registerSchemesAsPrivileged([
  { scheme: "media", privileges: { stream: true, supportFetchAPI: true, secure: true, bypassCSP: true } },
]);

// --- IPC -----------------------------------------------------------------

ipcMain.handle("open-video", async () => {
  const r = await dialog.showOpenDialog({
    title: "Apri video",
    properties: ["openFile"],
    filters: [{ name: "Video/Audio", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "wav", "mp3", "m4a", "aac"] }],
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

// Crea (una volta) il venv per la diarizzazione se manca.
function ensureDiarVenv(python, onLog) {
  if (fs.existsSync(python)) return Promise.resolve(true);
  const venvDir = path.dirname(path.dirname(python));
  onLog(`Preparo l'ambiente per gli speaker (una volta sola)…\n`);
  const sh = (cmd, args) =>
    new Promise((res, rej) => {
      const p = spawn(cmd, args, { env: { ...process.env, PATH: BIN_PATHS.concat(process.env.PATH || "").join(":") } });
      p.stdout.on("data", (d) => onLog(d.toString()));
      p.stderr.on("data", (d) => onLog(d.toString()));
      p.on("error", rej);
      p.on("close", (c) => (c === 0 ? res() : rej(new Error("setup venv fallito"))));
    });
  return sh("python3", ["-m", "venv", venvDir])
    .then(() => sh(python, ["-m", "pip", "install", "-q", "sherpa-onnx", "soundfile", "numpy"]))
    .then(() => true)
    .catch(() => false);
}

ipcMain.handle("transcribe", async (e, videoPath, opts = {}) => {
  const eng = enginePaths();
  // Invio protetto: se la finestra è stata chiusa/ricaricata mentre la
  // pipeline gira, non far esplodere il main process.
  const send = (d) => {
    if (!e.sender.isDestroyed()) {
      try { e.sender.send("transcribe-progress", d.toString()); } catch {}
    }
  };
  const wantSpeakers = !!(opts.speakers || "").trim();
  const force = !!opts.force;

  // Cache per-video: il transcript dipende anche da lingua/speaker; l'audio
  // estratto no (riusabile anche quando si "ricomincia da capo").
  const st = fs.statSync(videoPath);
  const vidKey = crypto.createHash("sha1").update(`${videoPath}|${st.size}|${st.mtimeMs}`).digest("hex").slice(0, 16);
  const tKey = crypto.createHash("sha1").update(`${vidKey}|${opts.lang || "it"}|${opts.speakers || ""}`).digest("hex").slice(0, 16);
  const cacheDir = path.join(app.getPath("userData"), "cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const transcriptCache = path.join(cacheDir, `t-${tKey}.json`);
  const wavCache = path.join(cacheDir, `a-${vidKey}.wav`);

  // Trascrizione già fatta per questo video → ricarica all'istante.
  if (!force && fs.existsSync(transcriptCache)) {
    send("[[PROG]] done 100\n");
    return { ...JSON.parse(fs.readFileSync(transcriptCache, "utf8")), cached: true };
  }

  if (wantSpeakers && !fs.existsSync(eng.venvPython)) {
    const ok = await ensureDiarVenv(eng.venvPython, send);
    if (!ok) send("⚠ Diarizzazione non disponibile, procedo senza speaker.\n");
  }

  const out = path.join(os.tmpdir(), `vte-${Date.now()}.json`);
  const args = [eng.transcribeScript, videoPath, "--lang", opts.lang || "it", "--out", out];
  if (wantSpeakers && fs.existsSync(eng.venvPython)) args.push("--speakers", opts.speakers.trim());

  await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, {
      cwd: path.dirname(eng.transcribeScript),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1", // usa il node di Electron, niente node di sistema
        PATH: BIN_PATHS.concat(process.env.PATH || "").join(":"),
        VTE_MODELS_DIR: eng.whisperModels,
        VTE_PYTHON: eng.venvPython,
        VTE_DIARIZE_MODELS: eng.diarizeModels,
        VTE_WAV_CACHE: wavCache, // riusa l'audio estratto tra un tentativo e l'altro
      },
    });
    // Se la finestra si chiude mentre trascrive, killa il sottoprocesso
    // (niente whisper/ffmpeg orfani) e termina senza errori.
    const onGone = () => { try { p.kill(); } catch {} };
    e.sender.once("destroyed", onGone);
    p.stdout.on("data", send);
    p.stderr.on("data", send);
    p.on("error", reject);
    p.on("close", (code) => {
      try { e.sender.off?.("destroyed", onGone); } catch {}
      let destroyed = false;
      try { destroyed = e.sender.isDestroyed(); } catch { destroyed = true; }
      if (destroyed) resolve(); // finestra chiusa: esci pulito
      else if (code === 0) resolve();
      else reject(new Error(`Trascrizione fallita (codice ${code})`));
    });
  });

  // Finestra chiusa a metà o output assente: esci senza errori.
  if (e.sender.isDestroyed() || !fs.existsSync(out)) return null;
  const data = JSON.parse(fs.readFileSync(out, "utf8"));
  fs.unlinkSync(out);
  fs.writeFileSync(transcriptCache, JSON.stringify(data)); // salva per riapertura istantanea
  fs.writeFileSync(path.join(cacheDir, `last-${vidKey}.json`), JSON.stringify(data)); // ultima per questo video
  return data;
});

// All'apertura di un video: se è già stato trascritto, ritorna la trascrizione
// in cache (qualunque lingua/speaker), così si recupera automaticamente.
ipcMain.handle("cached-transcript", async (_e, videoPath) => {
  try {
    const st = fs.statSync(videoPath);
    const vidKey = crypto.createHash("sha1").update(`${videoPath}|${st.size}|${st.mtimeMs}`).digest("hex").slice(0, 16);
    const f = path.join(app.getPath("userData"), "cache", `last-${vidKey}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
  } catch {
    return null;
  }
});

// --- Project manager: file in ~/Documents/v-editor/ ---------------------
function projectsDir() {
  const dir = path.join(app.getPath("documents"), "v-editor");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "progetto";

// Autosave: scrive il progetto come file leggibile in Documenti/v-editor.
ipcMain.handle("autosave-project", async (_e, name, data) => {
  try {
    const f = path.join(projectsDir(), `${slug(name)}.vte.json`);
    fs.writeFileSync(f, JSON.stringify(data, null, 2));
    return f;
  } catch (err) {
    logCrash("autosave", err);
    return null;
  }
});

// Elenco progetti (per "recenti"), ordinati per data di modifica.
ipcMain.handle("list-projects", async () => {
  try {
    const dir = projectsDir();
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith(".vte.json"))
      .map((f) => ({ name: f.replace(/\.vte\.json$/, ""), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
});

ipcMain.handle("read-project", async (_e, name) => {
  try {
    const f = path.join(projectsDir(), `${slug(name)}.vte.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
  } catch {
    return null;
  }
});

ipcMain.handle("save-project", async (_e, data, suggestedName) => {
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
