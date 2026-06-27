#!/usr/bin/env node
// Trascrizione LOCALE di file video/audio (anche da 10+ GB): nessun upload.
//   1. ffmpeg estrae l'audio a 16 kHz mono (l'audio è minuscolo rispetto al video)
//   2. whisper.cpp (Metal sul Mac) trascrive con timestamp a livello di token
//   3. raggruppiamo i token in parole con start/end e scriviamo transcript.json
//
// Uso:
//   npm run transcribe -- /percorso/al/video.mp4 [--model large-v3-turbo] [--lang it] [--out transcript.json]
//
// transcript.json si importa poi nell'editor collaborativo (pulsante "Importa").

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MODELS_DIR = join(ROOT, "models");

// ---- parsing argomenti --------------------------------------------------
const argv = process.argv.slice(2);
const input = argv.find((a) => !a.startsWith("--"));
const getOpt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const MODEL = getOpt("model", "large-v3-turbo");
const LANG = getOpt("lang", "auto");
const OUT = resolve(getOpt("out", join(process.cwd(), "transcript.json")));
// --speakers N  → diarizzazione con N speaker. --speakers auto → rilevamento automatico.
const SPEAKERS = getOpt("speakers", null);

if (!input) {
  console.error("✗ Manca il file. Uso: trascrivi /path/al/video.mp4 [--model ..] [--lang it]");
  process.exit(1);
}
const INPUT = resolve(input);
if (!existsSync(INPUT)) {
  console.error(`✗ File non trovato: ${INPUT}`);
  process.exit(1);
}

// ---- helper di esecuzione ----------------------------------------------
const run = (cmd, args, opts = {}) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("error", rej);
    p.on("close", (code) => (code === 0 ? res() : rej(new Error(`${cmd} uscito con codice ${code}`))));
  });

const which = (cmd) =>
  new Promise((res) => {
    const p = spawn("sh", ["-c", `command -v ${cmd}`], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (code) => res(code === 0 ? out.trim() : null));
  });

// Esegue un comando catturandone lo stdout (stderr passa a video).
const runCapture = (cmd, args) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", rej);
    p.on("close", (code) => (code === 0 ? res(out) : rej(new Error(`${cmd} uscito con codice ${code}`))));
  });

// ---- diarizzazione (chi parla quando) -----------------------------------
async function diarize(wav) {
  const py = join(ROOT, ".venv", "bin", "python");
  if (!existsSync(py)) {
    throw new Error(
      "Diarizzazione non configurata. Esegui:\n" +
      "  python3 -m venv .venv && .venv/bin/pip install sherpa-onnx soundfile numpy\n" +
      "e scarica i modelli in models/diarization/ (vedi README)."
    );
  }
  const args = [join(ROOT, "scripts", "diarize.py"), wav];
  if (SPEAKERS && SPEAKERS !== "auto") args.push("--num-speakers", SPEAKERS);
  const out = await runCapture(py, args);
  return JSON.parse(out); // [{start, end, speaker}]
}

// Assegna a ogni parola lo speaker del segmento che contiene il suo punto medio
// (o, se nessuno, il segmento più vicino).
function assignSpeakers(words, segments) {
  if (!segments.length) return;
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    let hit = segments.find((s) => s.start <= mid && mid < s.end);
    if (!hit) {
      let best = Infinity;
      for (const s of segments) {
        const d = mid < s.start ? s.start - mid : mid - s.end;
        if (d < best) { best = d; hit = s; }
      }
    }
    if (hit) w.speaker = hit.speaker;
  }
}

// ---- pre-requisiti -------------------------------------------------------
async function findWhisper() {
  for (const c of ["whisper-cli", "whisper-cpp", "main"]) {
    const path = await which(c);
    if (path) return path;
  }
  return null;
}

async function ensureModel() {
  mkdirSync(MODELS_DIR, { recursive: true });
  const modelPath = join(MODELS_DIR, `ggml-${MODEL}.bin`);
  if (existsSync(modelPath)) return modelPath;
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin`;
  console.log(`→ Scarico il modello "${MODEL}" (una volta sola)…\n  ${url}`);
  await run("curl", ["-L", "--fail", "-o", modelPath, url]);
  return modelPath;
}

// ---- token whisper.cpp → parole con timecode ----------------------------
function tokensToWords(full) {
  const words = [];
  for (const seg of full.transcription ?? []) {
    for (const tok of seg.tokens ?? []) {
      // token speciali whisper.cpp: [_BEG_], [_EOT_], [_TT_488] (timestamp), ecc.
      let raw = (tok.text ?? "").replace(/\[_[^\]]*\]/g, "");
      if (raw.trim() === "") continue;
      const start = (tok.offsets?.from ?? 0) / 1000;
      const end = (tok.offsets?.to ?? 0) / 1000;
      const startsWord = raw.startsWith(" ") || words.length === 0;
      if (startsWord) {
        words.push({ text: raw.trim(), start, end });
      } else {
        const w = words[words.length - 1];
        w.text += raw;
        w.end = end;
      }
    }
  }
  return words.filter((w) => w.text.length > 0);
}

// ---- main ----------------------------------------------------------------
(async () => {
  const whisper = await findWhisper();
  const hasFfmpeg = await which("ffmpeg");
  if (!whisper || !hasFfmpeg) {
    console.error("✗ Mancano gli strumenti. Installa con:  brew install ffmpeg whisper-cpp");
    process.exit(1);
  }

  const sizeGB = (statSync(INPUT).size / 1e9).toFixed(2);
  console.log(`→ Input: ${basename(INPUT)} (${sizeGB} GB)`);

  const wav = join(tmpdir(), `vte-${Date.now()}.wav`);
  console.log("→ Estraggo l'audio a 16 kHz mono…");
  await run("ffmpeg", ["-y", "-i", INPUT, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);

  const model = await ensureModel();
  const base = wav.replace(/\.wav$/, "");
  console.log(`→ Trascrivo con whisper.cpp (modello ${MODEL}, lingua ${LANG})…`);
  await run(whisper, [
    "-m", model,
    "-f", wav,
    "-l", LANG,
    "-ojf",            // JSON full: include i token con offset
    "-of", base,
    "-np",             // niente progress spam
  ]);

  const full = JSON.parse(readFileSync(`${base}.json`, "utf8"));
  const words = tokensToWords(full);

  if (SPEAKERS) {
    console.log(`→ Diarizzazione (speaker: ${SPEAKERS})…`);
    const segments = await diarize(wav);
    assignSpeakers(words, segments);
    const n = new Set(words.map((w) => w.speaker).filter(Boolean)).size;
    console.log(`  ${n} speaker assegnati alle parole.`);
  }

  const text = words.map((w) => w.text).join(" ");
  const out = {
    text,
    words,
    language: full.result?.language ?? LANG,
    source: basename(INPUT),
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\n✓ ${words.length} parole con timecode → ${OUT}`);
  console.log("  Aprilo nell'editor con il pulsante \"Importa transcript.json\".");
})().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
