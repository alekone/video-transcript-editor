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
import { Highlight } from "./extensions/Highlight";
import { Timecodes } from "./extensions/Timecodes";
import {
  buildEDL,
  buildFCPXML,
  buildSegments,
  buildCues,
  cuesToSRT,
  cuesToVTT,
  wordsToPlainText,
  collectKeptWords,
  collectHighlightedWords,
  downloadText,
  segmentsToText,
} from "./lib/exports";
import { isFiller, computeStats, suggestPauseThreshold, type Stats } from "./lib/transform";
import type { TranscriptResult, TranscriptWord } from "./types";

const COLORS = ["#f783ac", "#4dabf7", "#69db7c", "#ffd43b", "#9775fa", "#ff922b"];
const randomName = () => `Utente ${Math.floor(Math.random() * 1000)}`;
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

function speakerOrder(words: TranscriptWord[]): string[] {
  const seen: string[] = [];
  for (const w of words) if (w.speaker && !seen.includes(w.speaker)) seen.push(w.speaker);
  return seen;
}

function wordsToDoc(words: TranscriptWord[], speakers: string[]) {
  const spkIndex = (s?: string) => (s ? speakers.indexOf(s) % 8 : null);
  const paragraphs: TranscriptWord[][] = [[]];
  let prevSpeaker: string | undefined;
  let prevEnd: number | null = null;
  for (const w of words) {
    let cur = paragraphs[paragraphs.length - 1];
    const speakerChanged = w.speaker != null && w.speaker !== prevSpeaker && cur.length > 0;
    const longGap = prevEnd != null && w.start - prevEnd > 1.5 && cur.length > 0;
    if (speakerChanged || longGap) {
      paragraphs.push([w]);
      cur = paragraphs[paragraphs.length - 1];
    } else {
      cur.push(w);
    }
    if (w.speaker) prevSpeaker = w.speaker;
    prevEnd = w.end;
    // fine frase → nuovo paragrafo se quello attuale è già corposo (testo leggibile)
    if (/[.!?…]$/.test(w.text) && cur.length >= 12) paragraphs.push([]);
  }
  const content = paragraphs
    .filter((p) => p.length > 0)
    .map((p) => ({
      type: "paragraph",
      content: p.map((w) => ({
        type: "text",
        text: w.text + " ",
        marks: [{ type: "timing", attrs: { start: w.start, end: w.end, speaker: w.speaker ?? null, spk: spkIndex(w.speaker) } }],
      })),
    }));
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

export function Editor({ documentName }: { documentName: string }) {
  const [imported, setImported] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [fps, setFps] = useState(25);
  const [maxGap, setMaxGap] = useState(0); // 0 = non tagliare le pause
  const [numSpeakers, setNumSpeakers] = useState("2");
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; pct: number | null } | null>(null);
  // Dark di default (le buone app creative partono in scuro); "light" solo se scelto.
  const [dark, setDark] = useState(() => localStorage.getItem("vte-theme") !== "light");
  const [skipCuts, setSkipCuts] = useState(false); // anteprima montaggio in play
  const [stats, setStats] = useState<Stats | null>(null);
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [preview, setPreview] = useState<{
    keep: number; cut: number; segs: number; cuts: { start: number; end: number; text: string }[];
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const projRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cutRangesRef = useRef<{ start: number; end: number }[]>([]);
  const latestProject = useRef<() => unknown>(() => ({}));
  const streamedRef = useRef(false);

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

  // Dark mode
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("vte-theme", dark ? "dark" : "light");
  }, [dark]);

  // Ripristino automatico: speaker, fps e — su Electron — il video del progetto
  // (path salvato nel doc persistito). Così riaprendo il progetto torna tutto.
  const restoredVideo = useRef(false);
  useEffect(() => {
    const read = () => {
      const raw = meta.get("speakers");
      if (raw) setSpeakers(JSON.parse(raw));
      const f = meta.get("fps");
      if (f) setFps(Number(f));
      const vp = meta.get("videoPath");
      if (vp && isElectron && !restoredVideo.current) {
        restoredVideo.current = true;
        setVideoPath(vp);
        setVideoUrl(electronAPI!.mediaUrl(vp));
      }
    };
    read();
    meta.observe(read);
    return () => meta.unobserve(read);
  }, [meta]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      Timing,
      Highlight,
      Timecodes,
      Playhead,
      Collaboration.configure({ document: ydoc }),
      ...(provider
        ? [CollaborationCursor.configure({ provider, user: { name: randomName(), color: randomColor() } })]
        : []),
    ],
  });

  // Autosave (Electron): scrive il progetto in ~/Documents/v-editor/ poco
  // dopo ogni modifica. Niente "salva" manuale.
  useEffect(() => {
    if (!editor || !isElectron) return;
    let timer: ReturnType<typeof setTimeout>;
    const onUpdate = () => {
      clearTimeout(timer);
      timer = setTimeout(() => electronAPI!.autosaveProject(documentName, latestProject.current()), 1500);
    };
    editor.on("update", onUpdate);
    return () => { clearTimeout(timer); editor.off("update", onUpdate); };
  }, [editor, documentName]);

  // Ripristino da file: se il documento è vuoto ma esiste un .vte.json salvato
  // (es. dati solo su disco), caricalo. La persistenza viva è IndexedDB.
  useEffect(() => {
    if (!editor || !isElectron) return;
    const t = setTimeout(async () => {
      if (editor.getText().trim().length > 0) return; // già popolato da IndexedDB
      const p = await electronAPI!.readProject(documentName);
      if (p?.html && p.originalWords?.length) {
        meta.set("originalWords", JSON.stringify(p.originalWords));
        meta.set("speakers", JSON.stringify(p.speakers || []));
        if (p.source) meta.set("source", p.source);
        if (p.fps) { setFps(p.fps); meta.set("fps", String(p.fps)); }
        if (p.maxGap) setMaxGap(p.maxGap);
        if (p.numSpeakers) setNumSpeakers(String(p.numSpeakers));
        editor.commands.setContent(p.html);
        setSpeakers(p.speakers || []);
        setImported(p.originalWords.length);
        if (p.video) { setVideoPath(p.video); setVideoUrl(electronAPI!.mediaUrl(p.video)); restoredVideo.current = true; }
      }
    }, 900);
    return () => clearTimeout(t);
  }, [editor, documentName, meta]);

  // Scorciatoie: Alt+Space play/pausa
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.code === "Space" && videoRef.current) {
        e.preventDefault();
        videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function flash(msg: string) {
    setInfo(msg);
    setTimeout(() => setInfo(null), 4000);
  }

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
    if (data.fps) { setFps(data.fps); meta.set("fps", String(data.fps)); } // FPS rilevato + ricordato
  }

  // Oggetto progetto: tutti i setting + il testo editato (con evidenziazioni).
  function projectObject() {
    return {
      version: 1,
      name: documentName,
      video: videoPath,
      fps,
      numSpeakers,
      maxGap,
      originalWords: JSON.parse(meta.get("originalWords") || "[]"),
      speakers: JSON.parse(meta.get("speakers") || "[]"),
      source: meta.get("source") || null,
      html: editor?.getHTML() ?? "",
    };
  }
  latestProject.current = projectObject; // sempre l'ultimo stato per l'autosave

  // Salva un file di progetto .vte.json (download nel web, file in Documenti
  // su Electron è già fatto dall'autosave). Qui è l'export manuale.
  function saveProject() {
    if (!editor) return;
    downloadText(`${documentName}.vte.json`, JSON.stringify(projectObject()));
    flash("Progetto esportato.");
  }
  async function loadProject(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    setError(null);
    try {
      const p = JSON.parse(await file.text());
      setFps(p.fps || 25);
      setNumSpeakers(String(p.numSpeakers ?? "2"));
      setMaxGap(p.maxGap || 0);
      meta.set("originalWords", JSON.stringify(p.originalWords || []));
      meta.set("speakers", JSON.stringify(p.speakers || []));
      if (p.source) meta.set("source", p.source);
      editor.commands.setContent(p.html || "<p></p>");
      setSpeakers(p.speakers || []);
      setImported((p.originalWords || []).length);
      if (p.video && isElectron) {
        setVideoPath(p.video);
        setVideoUrl(electronAPI!.mediaUrl(p.video));
      }
      flash("Progetto caricato.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (projRef.current) projRef.current.value = "";
    }
  }

  function autoPause() {
    const raw = meta.get("originalWords");
    const words: TranscriptWord[] = raw ? JSON.parse(raw) : [];
    if (!words.length) return flash("Trascrivi prima un video.");
    const t = suggestPauseThreshold(words);
    setMaxGap(t);
    flash(`Soglia pause impostata a ${t}s (calcolata dai gap).`);
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

  // Appende una frase (segmento) in fondo all'editor, con timecode di frase,
  // senza spostare cursore/scroll dell'utente. Usato dallo streaming live.
  function appendSegment(start: number, end: number, text: string) {
    if (!editor) return;
    const schema = editor.schema;
    const mark = schema.marks.timing.create({ start, end, speaker: null, spk: null });
    const para = schema.nodes.paragraph.create(null, schema.text(text + " ", [mark]));
    const tr = editor.state.tr;
    // al primo segmento svuota il paragrafo vuoto iniziale
    if (!streamedRef.current) {
      streamedRef.current = true;
      tr.delete(0, tr.doc.content.size);
    }
    tr.insert(tr.doc.content.size, para);
    tr.setMeta("addToHistory", false);
    editor.view.dispatch(tr);
  }

  async function openVideoNative() {
    const path = await electronAPI!.openVideo();
    if (!path) return;
    setVideoPath(path);
    setVideoUrl(electronAPI!.mediaUrl(path));
    restoredVideo.current = true;
    meta.set("videoPath", path); // ricordato col progetto
    // recupero automatico: se questo video è già stato trascritto, ricaricalo
    const cached = await electronAPI!.cachedTranscript(path);
    if (cached && cached.words?.length) {
      importWords(cached);
      flash("Trascrizione recuperata dalla cache di questo video.");
    }
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

  async function transcribeNative(force = false) {
    if (!editor) return;
    if (!videoPath) return setError("Apri prima un video.");
    setError(null);
    setWorking(true);
    setProgress({ phase: "extract", pct: null });
    // Il testo si forma DENTRO l'editor: partiamo da vuoto e appendiamo le
    // frasi man mano che arrivano (timecode a livello di frase per il seek).
    editor.commands.clearContent(true);
    streamedRef.current = false;
    const unsubscribe = electronAPI!.onTranscribeProgress((chunk) => {
      for (const line of chunk.split("\n")) {
        const prog = line.match(/\[\[PROG\]\] (\w+)(?: (\d+))?/);
        if (prog) {
          setProgress({ phase: prog[1], pct: prog[2] != null ? Number(prog[2]) : null });
          continue;
        }
        // segmento whisper: "[00:00:00.000 --> 00:00:04.640]   testo"
        const m = line.match(/\[(\d{2}):(\d{2}):([\d.]+)\s*-->\s*(\d{2}):(\d{2}):([\d.]+)\]\s*(.+)$/);
        if (m && m[7].trim()) {
          const start = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
          const end = +m[4] * 3600 + +m[5] * 60 + parseFloat(m[6]);
          appendSegment(start, end, m[7].trim());
        }
      }
    });
    try {
      const spk = numSpeakers.trim();
      const data = await electronAPI!.transcribe(videoPath, {
        lang: "it",
        // speaker=1 → niente diarizzazione (inutile con un solo parlante)
        speakers: spk && spk !== "1" ? spk : undefined,
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
    const v = videoRef.current;
    if (!v) return;
    // Anteprima montaggio: salta automaticamente le parti tagliate in play.
    if (skipCuts && !v.paused) {
      const cut = cutRangesRef.current.find((c) => v.currentTime >= c.start - 0.05 && v.currentTime < c.end - 0.1);
      if (cut) {
        v.currentTime = cut.end;
        return;
      }
    }
    setPlayheadTime(editor, v.currentTime);
  }
  function onEditorClick(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest(".w") as HTMLElement | null;
    const start = el?.dataset.start;
    if (start != null && videoRef.current) {
      videoRef.current.currentTime = Number(start);
      void videoRef.current.play();
    }
  }

  // --- Strumenti (feature) ---------------------------------------------
  function removeFillers() {
    if (!editor) return;
    const tr = editor.state.tr;
    const ranges: { from: number; to: number }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.marks.some((m) => m.type.name === "timing") && isFiller(node.text || "")) {
        ranges.push({ from: pos, to: pos + node.nodeSize });
      }
    });
    ranges.sort((a, b) => b.from - a.from).forEach((r) => tr.delete(r.from, r.to));
    if (ranges.length) editor.view.dispatch(tr);
    flash(`${ranges.length} filler rimossi (ehm, cioè, tipo…)`);
  }

  function renameSpeaker(oldName: string, newName: string) {
    setRenaming(null);
    if (!editor || !newName || newName === oldName) return;
    const tm = editor.schema.marks.timing;
    const tr = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      const m = node.marks.find((mk) => mk.type.name === "timing");
      if (m && m.attrs.speaker === oldName) {
        tr.removeMark(pos, pos + node.nodeSize, tm);
        tr.addMark(pos, pos + node.nodeSize, tm.create({ ...m.attrs, speaker: newName }));
      }
    });
    editor.view.dispatch(tr);
    const spks = (JSON.parse(meta.get("speakers") || "[]") as string[]).map((s) => (s === oldName ? newName : s));
    meta.set("speakers", JSON.stringify(spks));
    const ow = (JSON.parse(meta.get("originalWords") || "[]") as TranscriptWord[]).map((w) =>
      w.speaker === oldName ? { ...w, speaker: newName } : w
    );
    meta.set("originalWords", JSON.stringify(ow));
    setSpeakers(spks);
  }

  function doFind() {
    if (!editor || !find) return;
    let target: { from: number; to: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (target || !node.isText || !node.text) return;
      const i = node.text.toLowerCase().indexOf(find.toLowerCase());
      if (i >= 0) target = { from: pos + i, to: pos + i + find.length };
    });
    if (target) {
      editor.chain().focus().setTextSelection(target).scrollIntoView().run();
    } else flash("Nessun risultato.");
  }

  function doReplaceAll() {
    if (!editor || !find) return;
    const matches: { from: number; to: number }[] = [];
    const needle = find.toLowerCase();
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return;
      const lower = node.text.toLowerCase();
      let i = lower.indexOf(needle);
      while (i >= 0) {
        matches.push({ from: pos + i, to: pos + i + find.length });
        i = lower.indexOf(needle, i + find.length);
      }
    });
    const tr = editor.state.tr;
    matches.sort((a, b) => b.from - a.from).forEach((m) => tr.insertText(replace, m.from, m.to));
    if (matches.length) editor.view.dispatch(tr);
    flash(`${matches.length} sostituzioni.`);
  }

  function showStats() {
    if (!editor) return;
    setStats(computeStats(collectKeptWords(editor)));
  }

  // --- Export ----------------------------------------------------------
  function keptWords() {
    return editor ? collectKeptWords(editor) : [];
  }
  function segments() {
    const raw = meta.get("originalWords");
    const original: TranscriptWord[] = raw ? JSON.parse(raw) : [];
    return {
      ...buildSegments(original, keptWords(), { maxGap: maxGap > 0 ? maxGap : undefined }),
      hasOriginal: original.length > 0,
    };
  }
  const source = () => (meta.get("source") as string) || "video.mp4";

  const exp = {
    keep: () => downloadText(`${documentName}-da-tenere.txt`, segmentsToText(segments().keep, "PARTI DA TENERE")),
    cut: () => {
      const s = segments();
      if (!s.hasOriginal) return setError("Importa/trascrivi prima il transcript.");
      downloadText(`${documentName}-tagli.txt`, segmentsToText(s.cut, "PARTI TAGLIATE (per il montatore)"));
    },
    edl: () => downloadText(`${documentName}.edl`, buildEDL(segments().keep, { fps, source: source(), title: documentName })),
    fcpxml: () => downloadText(`${documentName}.fcpxml`, buildFCPXML(segments().keep, { fps, source: source(), title: documentName })),
    srt: () => downloadText(`${documentName}.srt`, cuesToSRT(buildCues(keptWords()))),
    vtt: () => downloadText(`${documentName}.vtt`, cuesToVTT(buildCues(keptWords()))),
    txt: () => downloadText(`${documentName}.txt`, wordsToPlainText(keptWords())),
    md: () => downloadText(`${documentName}.md`, wordsToPlainText(keptWords(), true)),
    highlights: () => {
      if (!editor) return;
      const hw = collectHighlightedWords(editor);
      if (!hw.length) return flash("Evidenzia prima dei momenti (seleziona testo → ★).");
      const segs = buildSegments(hw, hw, { maxGap: maxGap > 0 ? maxGap : undefined }).keep;
      downloadText(`${documentName}-highlights.edl`, buildEDL(segs, { fps, source: source(), title: `${documentName} highlights` }));
    },
  };

  function setSpeed(v: number) {
    if (videoRef.current) videoRef.current.playbackRate = v;
  }

  // Anteprima del montaggio: quanto resta, quanto si taglia (incluse le pause
  // se "taglia pause" è attivo) e l'elenco dei tagli con timecode.
  function previewCuts() {
    const s = segments();
    if (!s.hasOriginal) return flash("Trascrivi/importa prima un transcript.");
    const dur = (segs: { start: number; end: number }[]) =>
      segs.reduce((a, x) => a + (x.end - x.start), 0);
    setPreview({ keep: dur(s.keep), cut: dur(s.cut), segs: s.keep.length, cuts: s.cut.slice(0, 100) });
  }

  // Attiva/disattiva l'anteprima del montaggio in riproduzione (salta i tagli).
  function toggleSkipCuts() {
    const next = !skipCuts;
    if (next) cutRangesRef.current = segments().cut;
    setSkipCuts(next);
    flash(next ? "Anteprima montaggio attiva: in play salta i tagli." : "Anteprima montaggio disattivata.");
  }

  if (!editor) return <p>Caricamento editor…</p>;

  return (
    <div className="layout">
      {/* Sidebar sinistra — strumenti sempre a portata mentre scrolli */}
      <aside className="sidebar">
        <div className="sidebar-group">
          <button className="btn full" onClick={() => editor.chain().focus().toggleMark("highlight").run()}
            title="Seleziona del testo e clicca per evidenziare. Per togliere: ri-seleziona la parte evidenziata e ri-clicca.">★ Evidenzia / togli</button>
          <button className="btn full" onClick={removeFillers}>✂︎ Rimuovi filler</button>
          <button className="btn full" onClick={showStats}>📊 Statistiche</button>
        </div>
        <div className="sidebar-group">
          <label className="field">velocità
            <select onChange={(e) => setSpeed(Number(e.target.value))} defaultValue="1">
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => <option key={v} value={v}>{v}×</option>)}
            </select>
          </label>
        </div>
        <div className="sidebar-group">
          <input className="find full" placeholder="Cerca…" value={find} onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doFind()} />
          <div className="row">
            <button className="btn ghost" onClick={doFind}>Trova</button>
          </div>
          <input className="find full" placeholder="Sostituisci con…" value={replace} onChange={(e) => setReplace(e.target.value)} />
          <button className="btn ghost full" onClick={doReplaceAll}>Sostituisci tutto</button>
        </div>
        <div className="sidebar-group">
          <label className="upload sm full">
            <input ref={fileRef} type="file" accept="application/json,.json" onChange={onImport} />
            Importa transcript.json
          </label>
        </div>
      </aside>

      <div className="content">
      {/* Barra principale — solo l'essenziale */}
      <div className="toolbar">
        {isElectron ? (
          <button className="btn primary" onClick={openVideoNative}>🎬 Apri video</button>
        ) : (
          <label className="upload">
            <input type="file" accept="video/*,audio/*" onChange={onPickVideo} />
            🎬 Apri video
          </label>
        )}
        {isElectron && (
          <>
            <label className="field">speaker
              <input type="text" value={numSpeakers} onChange={(e) => setNumSpeakers(e.target.value)} placeholder="2/auto" size={4} />
            </label>
            <button className="btn primary" onClick={() => transcribeNative(false)} disabled={working}>Trascrivi</button>
            <button className="btn ghost" onClick={() => transcribeNative(true)} disabled={working || !videoPath} title="Rifà da capo (riusa l'audio)">↻</button>
          </>
        )}
        <span className="spacer" />
        <button className="btn ghost" onClick={saveProject} title="Esporta il progetto come file .vte.json">Esporta progetto</button>
        <label className="upload sm">
          <input ref={projRef} type="file" accept=".json,application/json" onChange={loadProject} />
          Apri progetto
        </label>
        <button className="btn ghost" onClick={() => setDark((d) => !d)} title="Tema chiaro/scuro">{dark ? "☀︎" : "☾"}</button>
      </div>

      {/* Tagli & montaggio — a scomparsa */}
      <details className="section">
        <summary>✂️ Tagli & anteprima montaggio</summary>
        <div className="toolbar tools">
          <label className="field">taglia pause &gt;
            <input type="number" min={0} step={0.5} value={maxGap} onChange={(e) => setMaxGap(Number(e.target.value) || 0)} /> s
          </label>
          <button className="btn ghost" onClick={autoPause} title="Calcola la soglia analizzando le pause del parlato">auto</button>
          <button className="btn" onClick={previewCuts}>👁 Anteprima tagli</button>
          <button className={`btn${skipCuts ? " primary" : ""}`} onClick={toggleSkipCuts}
            title="In riproduzione salta automaticamente le parti tagliate (anteprima del montaggio finale)">
            ▶ Anteprima in play {skipCuts ? "ON" : "OFF"}
          </button>
        </div>
      </details>

      {/* Export — a scomparsa */}
      <details className="section">
        <summary>⬇️ Esporta</summary>
        <div className="toolbar export">
          <label className="field">fps<input type="number" value={fps} onChange={(e) => setFps(Number(e.target.value) || 25)} /></label>
          <span className="group-label">montaggio:</span>
          <button className="btn" onClick={exp.edl}>EDL</button>
          <button className="btn" onClick={exp.fcpxml}>FCPXML</button>
          <span className="group-label">sottotitoli:</span>
          <button className="btn" onClick={exp.srt}>SRT</button>
          <button className="btn" onClick={exp.vtt}>VTT</button>
          <span className="group-label">testo:</span>
          <button className="btn" onClick={exp.txt}>TXT</button>
          <button className="btn" onClick={exp.md}>MD</button>
          <span className="group-label">altro:</span>
          <button className="btn" onClick={exp.highlights}>★ Highlights</button>
          <button className="btn ghost" onClick={exp.keep}>tenuti</button>
          <button className="btn ghost" onClick={exp.cut}>tagli</button>
        </div>
      </details>

      <div className="status">
        {imported != null && !working && <span className="ok">✓ {imported} parole</span>}
        {info && <span className="ok">{info}</span>}
        {error && <span className="err">⚠ {error}</span>}
      </div>

      {working && progress && (
        <div className="progress">
          <div className="progress-label">
            {PHASE_LABEL[progress.phase] ?? progress.phase}
            {progress.phase === "transcribe" && progress.pct != null ? ` ${progress.pct}%` : ""}
          </div>
          <div className="progress-track">
            <div className={`progress-fill${progress.pct == null ? " indeterminate" : ""}`}
              style={progress.pct != null ? { width: `${progress.pct}%` } : undefined} />
          </div>
        </div>
      )}

      {speakers.length > 0 && (
        <div className="legend">
          {speakers.map((s, i) =>
            renaming === s ? (
              <input
                key={s}
                className={`find spk-${i % 8}`}
                autoFocus
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") renameSpeaker(s, renameVal.trim());
                  if (e.key === "Escape") setRenaming(null);
                }}
                onBlur={() => renameSpeaker(s, renameVal.trim())}
              />
            ) : (
              <button
                key={s}
                className={`legend-item spk-${i % 8}`}
                onClick={() => { setRenaming(s); setRenameVal(s); }}
                title="Clicca per rinominare"
              >
                ● {s} ✎
              </button>
            )
          )}
        </div>
      )}

      {stats && (
        <div className="stats">
          <div className="stats-head">
            <strong>Statistiche</strong> · {stats.totalWords} parole · parlato {Math.round(stats.speakingDuration / 60)} min
            <button className="btn ghost" onClick={() => setStats(null)}>✕</button>
          </div>
          {stats.speakers.map((s) => (
            <div key={s.speaker} className="stats-row">
              <span>{s.speaker}</span>
              <div className="stats-bar"><div style={{ width: `${s.pct}%` }} /></div>
              <span>{Math.round(s.pct)}% · {s.words} parole</span>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="stats">
          <div className="stats-head">
            <strong>Anteprima montaggio</strong> · ✅ tieni {Math.round(preview.keep / 60)} min ({preview.segs} segmenti) ·
            ✂︎ tagli {Math.round(preview.cut / 60)} min
            <button className="btn ghost" onClick={() => setPreview(null)}>✕</button>
          </div>
          <div className="cuts-list">
            {preview.cuts.length === 0 && <div className="hint">Nessun taglio: imposta "taglia pause" o cancella del testo.</div>}
            {preview.cuts.map((c, i) => (
              <div key={i} className="cut-row" title="Clicca per saltare qui nel video"
                onClick={() => { if (videoRef.current) { videoRef.current.currentTime = c.start; videoRef.current.play(); } }}>
                <span className="cut-tc">✂︎ {fmt(c.start)} → {fmt(c.end)}</span>
                <span className="cut-text">{c.text.slice(0, 80)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {videoUrl && (
        <video ref={videoRef} src={videoUrl} controls className="player" onTimeUpdate={onTimeUpdate} />
      )}

      <div className="editor" onClick={onEditorClick}>
        <EditorContent editor={editor} />
      </div>
      </div>
    </div>
  );
}
