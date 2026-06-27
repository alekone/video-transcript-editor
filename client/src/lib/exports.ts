import type { Editor } from "@tiptap/react";
import type { TranscriptWord } from "../types";

// HH:MM:SS.mmm — leggibile e non ambiguo per un montatore.
export function formatTc(seconds: number): string {
  const ms = Math.round((seconds % 1) * 1000);
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)}.${p(ms, 3)}`;
}

// Parole ancora presenti nel documento (sopravvissute all'editing), con timecode.
export function collectKeptWords(editor: Editor): TranscriptWord[] {
  const kept: TranscriptWord[] = [];
  editor.state.doc.descendants((node) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type.name === "timing");
    if (!mark) return;
    const { start, end } = mark.attrs as { start: number | null; end: number | null };
    if (start == null || end == null) return;
    kept.push({ text: (node.text ?? "").trim(), start, end });
  });
  return kept;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
}

// Divide la timeline originale in segmenti TENUTI e TAGLIATI confrontando i
// timecode delle parole superstiti con quelli originali. Restituisce entrambe
// le liste in ordine cronologico.
export function buildSegments(
  originalWords: TranscriptWord[],
  keptWords: TranscriptWord[]
): { keep: Segment[]; cut: Segment[] } {
  const keptKeys = new Set(keptWords.map((w) => `${w.start}-${w.end}`));
  const sorted = [...originalWords].sort((a, b) => a.start - b.start);

  const keep: Segment[] = [];
  const cut: Segment[] = [];
  let cur: Segment | null = null;
  let curKept: boolean | null = null;

  const flush = () => {
    if (cur && curKept != null) (curKept ? keep : cut).push(cur);
    cur = null;
  };

  for (const w of sorted) {
    const isKept = keptKeys.has(`${w.start}-${w.end}`);
    if (curKept !== isKept) {
      flush();
      curKept = isKept;
      cur = { start: w.start, end: w.end, text: w.text };
    } else if (cur) {
      cur.end = w.end;
      cur.text += " " + w.text;
    }
  }
  flush();
  return { keep, cut };
}

// Report leggibile per un montatore umano.
export function segmentsToText(segments: Segment[], title: string): string {
  const lines = segments.map(
    (s) => `${formatTc(s.start)} → ${formatTc(s.end)}   ${s.text}`
  );
  const totale = segments.reduce((acc, s) => acc + (s.end - s.start), 0);
  return [
    title,
    `${segments.length} segmenti · ${formatTc(totale)} totali`,
    "".padEnd(60, "-"),
    ...lines,
    "",
  ].join("\n");
}

// --- Export EDL (CMX3600) per DaVinci Resolve --------------------------
// Timecode frame-accurate HH:MM:SS:FF al frame rate del progetto.
function tcFrames(seconds: number, fps: number): string {
  let f = Math.round(seconds * fps);
  const ff = f % fps;
  let t = Math.floor(f / fps);
  const ss = t % 60;
  t = Math.floor(t / 60);
  const mm = t % 60;
  const hh = Math.floor(t / 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

// Costruisce un EDL dai segmenti TENUTI: ognuno è un evento con source in/out
// (dal video originale) e record in/out (sequenziale sulla timeline montata).
export function buildEDL(
  keep: Segment[],
  opts: { fps?: number; source?: string; title?: string } = {}
): string {
  const fps = opts.fps ?? 25;
  const source = opts.source ?? "video.mp4";
  const title = opts.title ?? "v-editor";
  const lines = [`TITLE: ${title}`, "FCM: NON-DROP FRAME", ""];
  let rec = 0; // posizione corrente sulla timeline, in secondi
  keep.forEach((seg, i) => {
    const dur = seg.end - seg.start;
    const num = String(i + 1).padStart(3, "0");
    // Canale "B" = video + audio: l'EDL monta sia immagine sia parlato.
    lines.push(
      `${num}  AX       B     C        ` +
        `${tcFrames(seg.start, fps)} ${tcFrames(seg.end, fps)} ` +
        `${tcFrames(rec, fps)} ${tcFrames(rec + dur, fps)}`
    );
    lines.push(`* FROM CLIP NAME: ${source}`);
    rec += dur;
  });
  return lines.join("\n") + "\n";
}

export function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
