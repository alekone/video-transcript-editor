import { Mark, mergeAttributes } from "@tiptap/core";

// Mark che àncora un intervallo di testo al suo timecode (in secondi).
// Applicato a ogni parola trascritta: quando tagli/sposti il testo, le parole
// superstiti conservano start/end → da qui si ricava l'EDL per DaVinci.
export const Timing = Mark.create({
  name: "timing",

  // Non unire automaticamente parole adiacenti: ognuna ha il suo timecode.
  inclusive: false,

  addAttributes() {
    return {
      start: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("data-start");
          return v == null ? null : Number(v);
        },
        renderHTML: (attrs) =>
          attrs.start == null ? {} : { "data-start": String(attrs.start) },
      },
      end: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("data-end");
          return v == null ? null : Number(v);
        },
        renderHTML: (attrs) =>
          attrs.end == null ? {} : { "data-end": String(attrs.end) },
      },
      speaker: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-speaker"),
        renderHTML: (attrs) =>
          attrs.speaker == null ? {} : { "data-speaker": String(attrs.speaker) },
      },
      // indice colore (0..7) dello speaker, calcolato all'import
      spk: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("data-spk");
          return v == null ? null : Number(v);
        },
        renderHTML: (attrs) =>
          attrs.spk == null ? {} : { "data-spk": String(attrs.spk) },
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-start]" }];
  },

  renderHTML({ HTMLAttributes, mark }) {
    const { start, end, speaker, spk } = mark.attrs as {
      start: number | null;
      end: number | null;
      speaker: string | null;
      spk: number | null;
    };
    const tc = start == null ? "" : `${start.toFixed(2)}s → ${end?.toFixed(2)}s`;
    const title = speaker ? `${speaker} · ${tc}` : tc || undefined;
    const cls = spk == null ? "w" : `w spk-${spk}`;
    return ["span", mergeAttributes(HTMLAttributes, { class: cls, title }), 0];
  },
});
