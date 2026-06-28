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
    const { start, end, speaker } = mark.attrs as {
      start: number | null;
      end: number | null;
      speaker: string | null;
    };
    if (start == null || end == null) return;
    kept.push({ text: (node.text ?? "").trim(), start, end, speaker: speaker ?? undefined });
  });
  return kept;
}

// Parole con il mark `highlight` (per la highlights reel).
export function collectHighlightedWords(editor: Editor): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  editor.state.doc.descendants((node) => {
    if (!node.isText) return;
    const timing = node.marks.find((m) => m.type.name === "timing");
    const hl = node.marks.find((m) => m.type.name === "highlight");
    if (!timing || !hl) return;
    const { start, end, speaker } = timing.attrs as any;
    if (start == null || end == null) return;
    out.push({ text: (node.text ?? "").trim(), start, end, speaker: speaker ?? undefined });
  });
  return out;
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
  keptWords: TranscriptWord[],
  opts: { maxGap?: number } = {}
): { keep: Segment[]; cut: Segment[] } {
  // maxGap: se due parole tenute consecutive distano più di tot secondi, si
  // spezza il segmento → la pausa viene esclusa dal montaggio (taglio pause).
  const maxGap = opts.maxGap ?? Infinity;
  const keptKeys = new Set(keptWords.map((w) => `${w.start}-${w.end}`));
  const sorted = [...originalWords].sort((a, b) => a.start - b.start);

  const keep: Segment[] = [];
  const cut: Segment[] = [];
  let cur: Segment | null = null;
  let curKept: boolean | null = null;
  let prevEnd = 0;

  const flush = () => {
    if (cur && curKept != null) (curKept ? keep : cut).push(cur);
    cur = null;
  };

  for (const w of sorted) {
    const isKept = keptKeys.has(`${w.start}-${w.end}`);
    const longPause = isKept && curKept === true && w.start - prevEnd > maxGap;
    if (curKept !== isKept || longPause) {
      flush();
      curKept = isKept;
      cur = { start: w.start, end: w.end, text: w.text };
    } else if (cur) {
      cur.end = w.end;
      cur.text += " " + w.text;
    }
    prevEnd = w.end;
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

// --- Sottotitoli (SRT / VTT) -------------------------------------------
export interface Cue {
  start: number;
  end: number;
  text: string;
}

// Raggruppa le parole in battute leggibili: max ~42 caratteri o 8 parole,
// si chiude su punteggiatura forte, cambio speaker o pausa > 0.8s.
export function buildCues(words: TranscriptWord[]): Cue[] {
  const cues: Cue[] = [];
  let cur: { words: TranscriptWord[] } | null = null;
  const flush = () => {
    if (cur && cur.words.length) {
      cues.push({
        start: cur.words[0].start,
        end: cur.words[cur.words.length - 1].end,
        text: cur.words.map((w) => w.text).join(" "),
      });
    }
    cur = null;
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!cur) cur = { words: [] };
    const prev = cur.words[cur.words.length - 1];
    const gap = prev ? w.start - prev.end : 0;
    const len = cur.words.reduce((a, x) => a + x.text.length + 1, 0);
    const speakerChanged = prev && w.speaker !== prev.speaker;
    if (cur.words.length && (len > 42 || cur.words.length >= 8 || gap > 0.8 || speakerChanged)) {
      flush();
      cur = { words: [] };
    }
    cur.words.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  return cues;
}

const srtTc = (s: number) => formatTc(s).replace(".", ",");

export function cuesToSRT(cues: Cue[]): string {
  return (
    cues
      .map((c, i) => `${i + 1}\n${srtTc(c.start)} --> ${srtTc(c.end)}\n${c.text}`)
      .join("\n\n") + "\n"
  );
}

export function cuesToVTT(cues: Cue[]): string {
  return (
    "WEBVTT\n\n" +
    cues.map((c) => `${formatTc(c.start)} --> ${formatTc(c.end)}\n${c.text}`).join("\n\n") +
    "\n"
  );
}

// --- Testo semplice / Markdown -----------------------------------------
// Raggruppa per turni di speaker.
export function wordsToPlainText(words: TranscriptWord[], markdown = false): string {
  const lines: string[] = [];
  let speaker: string | undefined;
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    const text = buf.join(" ");
    if (speaker) lines.push(markdown ? `**${speaker}:** ${text}` : `${speaker}: ${text}`);
    else lines.push(text);
    buf = [];
  };
  for (const w of words) {
    if (w.speaker !== speaker && buf.length) flush();
    speaker = w.speaker;
    buf.push(w.text);
  }
  flush();
  return lines.join("\n\n") + "\n";
}

// --- FCPXML (timeline multi-traccia per Resolve/Premiere/FCP) ----------
// Rational time a frame: N/<fps>s. Un asset-clip per segmento tenuto.
export function buildFCPXML(
  keep: Segment[],
  opts: { fps?: number; source?: string; title?: string } = {}
): string {
  const fps = opts.fps ?? 25;
  const src = opts.source ?? "video.mp4";
  const title = opts.title ?? "v-editor";
  const t = (sec: number) => `${Math.round(sec * fps)}/${fps}s`;
  const totalDur = keep.reduce((a, s) => a + (s.end - s.start), 0);
  let offset = 0;
  const clips = keep
    .map((s) => {
      const dur = s.end - s.start;
      const c = `        <asset-clip ref="r2" offset="${t(offset)}" name="${src}" start="${t(s.start)}" duration="${t(dur)}"/>`;
      offset += dur;
      return c;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="FFVideoFormat" frameDuration="1/${fps}s"/>
    <asset id="r2" name="${src}" hasVideo="1" hasAudio="1" format="r1">
      <media-rep kind="original-media" src="${src}"/>
    </asset>
  </resources>
  <library>
    <event name="${title}">
      <project name="${title}">
        <sequence format="r1" duration="${t(totalDur)}">
          <spine>
${clips}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
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
