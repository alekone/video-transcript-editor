import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { REALTIME_URL } from "./lib/realtime";
import { isElectron, electronAPI } from "./lib/platform";
import { Timing } from "./extensions/Timing";
import { Playhead, setPlayheadTime } from "./extensions/Playhead";
import {
  buildEDL,
  buildSegments,
  collectKeptWords,
  downloadText,
  segmentsToText,
} from "./lib/exports";
import type { TranscriptResult, TranscriptWord } from "./types";

const COLORS = ["#f783ac", "#4dabf7", "#69db7c", "#ffd43b", "#9775fa", "#ff922b"];
const randomName = () => `Utente ${Math.floor(Math.random() * 1000)}`;
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

// Ordine di comparsa degli speaker → usato per assegnare i colori.
function speakerOrder(words: TranscriptWord[]): string[] {
  const seen: string[] = [];
  for (const w of words) {
    if (w.speaker && !seen.includes(w.speaker)) seen.push(w.speaker);
  }
  return seen;
}

// transcript.json (parole con timecode) → documento ProseMirror in cui ogni
// parola è testo con il mark `timing`. Nuovo paragrafo al cambio di speaker
// (o sulla punteggiatura forte) e colore per speaker.
function wordsToDoc(words: TranscriptWord[], speakers: string[]) {
  const spkIndex = (s?: string) => (s ? speakers.indexOf(s) % 8 : null);

  const paragraphs: TranscriptWord[][] = [[]];
  let prevSpeaker: string | undefined;
  for (const w of words) {
    const cur = paragraphs[paragraphs.length - 1];
    const speakerChanged = w.speaker != null && w.speaker !== prevSpeaker && cur.length > 0;
    if (speakerChanged) paragraphs.push([w]);
    else cur.push(w);
    if (w.speaker) prevSpeaker = w.speaker;
    if (/[.!?…]$/.test(w.text) && !w.speaker) paragraphs.push([]);
  }
  const content = paragraphs
    .filter((p) => p.length > 0)
    .map((p) => ({
      type: "paragraph",
      content: p.map((w) => ({
        type: "text",
        text: w.text + " ",
        marks: [
          {
            type: "timing",
            attrs: {
              start: w.start,
              end: w.end,
              speaker: w.speaker ?? null,
              spk: spkIndex(w.speaker),
            },
          },
        ],
      })),
    }));
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

export function Editor({ documentName }: { documentName: string }) {
  const [imported, setImported] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoPath, setVideoPath] = useState<string | null>(null); // solo Electron
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [fps, setFps] = useState(25);
  const [numSpeakers, setNumSpeakers] = useState("2");
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; pct: number | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // ydoc + persistenza locale (IndexedDB). Nel web: anche sync col server
  // (Render). In Electron: solo locale, niente server.
  const { ydoc, provider, meta } = useMemo(() => {
    const ydoc = new Y.Doc();
    new IndexeddbPersistence(`v-editor:${documentName}`, ydoc);
    const provider = isElectron
      ? null
      : new HocuspocusProvider({ url: REALTIME_URL, name: documentName, document: ydoc });
    const meta = ydoc.getMap<string>("meta");
    return { ydoc, provider, meta };
  }, [documentName]);

  useEffect(() => () => provider?.destroy(), [provider]);

  useEffect(() => {
    const read = () => {
      const raw = meta.get("speakers");
      if (raw) setSpeakers(JSON.parse(raw));
    };
    read();
    meta.observe(read);
    return () => meta.unobserve(read);
  }, [meta]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      Timing,
      Playhead,
      Collaboration.configure({ document: ydoc }),
      // Cursori dei collaboratori solo nel web (serve un provider).
      ...(provider
        ? [
            CollaborationCursor.configure({
              provider,
              user: { name: randomName(), color: randomColor() },
            }),
          ]
        : []),
    ],
  });

  // Carica un transcript (da file o da trascrizione) nel documento.
  function importWords(data: TranscriptResult) {
    if (!editor) return;
    if (!Array.isArray(data.words)) throw new Error("transcript senza campo 'words'");
    const spks = speakerOrder(data.words);
    editor.commands.setContent(wordsToDoc(data.words, spks));
    meta.set("originalWords", JSON.stringify(data.words));
    meta.set("speakers", JSON.stringify(spks));
    if (data.source) meta.set("source", data.source);
    setSpeakers(spks);
    setImported(data.words.length);
  }

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      importWords(JSON.parse(await file.text()) as TranscriptResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Apertura video: nativa in Electron (path persistente), file-picker nel web.
  async function openVideoNative() {
    const path = await electronAPI!.openVideo();
    if (!path) return;
    setVideoPath(path);
    setVideoUrl(electronAPI!.mediaUrl(path));
  }
  function onPickVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoUrl((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }
  useEffect(() => () => {
    if (videoUrl?.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  // Trascrizione integrata (solo Electron): lancia la pipeline locale.
  // force=true ricomincia da capo ignorando la cache (riusa però l'audio).
  async function transcribeNative(force = false) {
    if (!videoPath) {
      setError("Apri prima un video.");
      return;
    }
    setError(null);
    setWorking(true);
    setProgress({ phase: "extract", pct: null });
    // Avanzamento: righe `[[PROG]] <fase> <pct?>` emesse dalla pipeline.
    const unsubscribe = electronAPI!.onTranscribeProgress((line) => {
      const matches = [...line.matchAll(/\[\[PROG\]\] (\w+)(?: (\d+))?/g)];
      const last = matches[matches.length - 1];
      if (last) setProgress({ phase: last[1], pct: last[2] != null ? Number(last[2]) : null });
    });
    try {
      const data = await electronAPI!.transcribe(videoPath, {
        lang: "it",
        speakers: numSpeakers.trim() || undefined,
        force,
      });
      if (data) importWords(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      unsubscribe();
      setWorking(false);
      setProgress(null);
    }
  }

  const PHASE_LABEL: Record<string, string> = {
    extract: "Estrazione audio…",
    download: "Download modello (una volta sola)…",
    transcribe: "Trascrizione",
    diarize: "Riconoscimento speaker…",
    done: "Completato",
  };

  function onTimeUpdate() {
    if (videoRef.current) setPlayheadTime(editor, videoRef.current.currentTime);
  }

  function onEditorClick(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest(".w") as HTMLElement | null;
    const start = el?.dataset.start;
    if (start != null && videoRef.current) {
      videoRef.current.currentTime = Number(start);
      void videoRef.current.play();
    }
  }

  function getSegments() {
    if (!editor) return null;
    const raw = meta.get("originalWords");
    const original: TranscriptWord[] = raw ? JSON.parse(raw) : [];
    const kept = collectKeptWords(editor);
    return { ...buildSegments(original, kept), hasOriginal: original.length > 0 };
  }

  function exportKeep() {
    const seg = getSegments();
    if (!seg) return;
    downloadText(
      `${documentName}-da-tenere.txt`,
      segmentsToText(seg.keep, "PARTI DA TENERE (timecode del video originale)")
    );
  }

  function exportCut() {
    const seg = getSegments();
    if (!seg) return;
    if (!seg.hasOriginal) {
      setError("Per esportare i tagli devi prima importare/trascrivere il transcript.");
      return;
    }
    downloadText(
      `${documentName}-tagli.txt`,
      segmentsToText(seg.cut, "PARTI TAGLIATE — da rimuovere (per il montatore)")
    );
  }

  function exportEDL() {
    const seg = getSegments();
    if (!seg) return;
    const source = (meta.get("source") as string) || "video.mp4";
    downloadText(
      `${documentName}.edl`,
      buildEDL(seg.keep, { fps, source, title: documentName })
    );
  }

  if (!editor) return <p>Caricamento editor…</p>;

  return (
    <div>
      <div className="toolbar">
        {isElectron ? (
          <button className="btn" onClick={openVideoNative}>Apri video</button>
        ) : (
          <label className="upload">
            <input type="file" accept="video/*,audio/*" onChange={onPickVideo} />
            Apri video
          </label>
        )}

        {isElectron && (
          <>
            <label className="field">
              speaker
              <input
                type="text"
                value={numSpeakers}
                onChange={(e) => setNumSpeakers(e.target.value)}
                placeholder="2 / auto / vuoto"
                size={6}
              />
            </label>
            <button className="btn" onClick={() => transcribeNative(false)} disabled={working}>
              Trascrivi
            </button>
            <button
              className="btn"
              onClick={() => transcribeNative(true)}
              disabled={working || !videoPath}
              title="Ignora la trascrizione in cache e rifà da capo (riusa l'audio già estratto)"
            >
              ↻ da capo
            </button>
          </>
        )}

        <label className="upload">
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onImport} />
          Importa transcript.json
        </label>

        <button className="btn" onClick={exportKeep}>Esporta tenuti</button>
        <button className="btn" onClick={exportCut}>Esporta tagli</button>
        <label className="field">
          fps
          <input
            type="number"
            value={fps}
            onChange={(e) => setFps(Number(e.target.value) || 25)}
            size={3}
          />
        </label>
        <button className="btn" onClick={exportEDL}>Esporta EDL (DaVinci)</button>

        {imported != null && !working && <span className="ok">✓ {imported} parole</span>}
        {error && <span className="err">⚠ {error}</span>}
      </div>

      {working && progress && (
        <div className="progress">
          <div className="progress-label">
            {PHASE_LABEL[progress.phase] ?? progress.phase}
            {progress.phase === "transcribe" && progress.pct != null ? ` ${progress.pct}%` : ""}
          </div>
          <div className="progress-track">
            <div
              className={`progress-fill${progress.pct == null ? " indeterminate" : ""}`}
              style={progress.pct != null ? { width: `${progress.pct}%` } : undefined}
            />
          </div>
        </div>
      )}

      {speakers.length > 0 && (
        <div className="legend">
          {speakers.map((s, i) => (
            <span key={s} className={`legend-item spk-${i % 8}`}>
              ● {s}
            </span>
          ))}
        </div>
      )}

      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          className="player"
          onTimeUpdate={onTimeUpdate}
        />
      )}

      <div className="editor" onClick={onEditorClick}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
