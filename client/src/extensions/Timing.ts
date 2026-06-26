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
    };
  },

  parseHTML() {
    return [{ tag: "span[data-start]" }];
  },

  renderHTML({ HTMLAttributes, mark }) {
    const { start, end } = mark.attrs as { start: number | null; end: number | null };
    const title =
      start == null ? undefined : `${start.toFixed(2)}s → ${end?.toFixed(2)}s`;
    return ["span", mergeAttributes(HTMLAttributes, { class: "w", title }), 0];
  },
});
