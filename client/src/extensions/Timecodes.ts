import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Mostra, accanto a ogni paragrafo, il timecode della prima parola — piccolo,
// grigio, non invadente (in un gutter a sinistra). Solo lettura.
export const timecodesKey = new PluginKey("timecodes");

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function build(doc: any): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node: any, pos: number) => {
    if (node.type.name !== "paragraph" || node.childCount === 0) return;
    let start: number | null = null;
    node.descendants((child: any) => {
      if (start != null || !child.isText) return;
      const m = child.marks.find((mk: any) => mk.type.name === "timing");
      if (m && m.attrs.start != null) start = m.attrs.start;
    });
    if (start != null) {
      decos.push(
        Decoration.widget(pos + 1, () => {
          const el = document.createElement("span");
          el.className = "tc-gutter";
          el.textContent = fmt(start as number);
          el.contentEditable = "false";
          return el;
        }, { side: -1 })
      );
    }
    return false; // non scendere nei figli del paragrafo
  });
  return DecorationSet.create(doc, decos);
}

export const Timecodes = Extension.create({
  name: "timecodes",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: timecodesKey,
        state: {
          init: (_c, state) => build(state.doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return timecodesKey.getState(state);
          },
        },
      }),
    ];
  },
});
