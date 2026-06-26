import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Evidenzia la parola la cui finestra [start, end) contiene il tempo di
// riproduzione corrente. Lo stato è view-only (decorazioni): NON tocca il
// documento, quindi non finisce in Yjs né disturba la collaborazione.
export const playheadKey = new PluginKey("playhead");

function decorateAt(doc: any, time: number): DecorationSet {
  if (time < 0) return DecorationSet.empty;
  let found: Decoration | null = null;
  doc.descendants((node: any, pos: number) => {
    if (found) return false;
    if (!node.isText) return;
    const mark = node.marks.find((m: any) => m.type.name === "timing");
    if (!mark) return;
    const { start, end } = mark.attrs;
    if (start != null && start <= time && time < end) {
      found = Decoration.inline(pos, pos + node.nodeSize, { class: "playing" });
      return false;
    }
  });
  return found ? DecorationSet.create(doc, [found]) : DecorationSet.empty;
}

export const Playhead = Extension.create({
  name: "playhead",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: playheadKey,
        state: {
          init: () => ({ time: -1, deco: DecorationSet.empty }),
          apply(tr, value, _old, newState) {
            const meta = tr.getMeta(playheadKey);
            if (meta && typeof meta.time === "number") {
              return { time: meta.time, deco: decorateAt(newState.doc, meta.time) };
            }
            // Nessun cambio di tempo: rimappa la decorazione sul nuovo doc.
            return { time: value.time, deco: value.deco.map(tr.mapping, tr.doc) };
          },
        },
        props: {
          decorations(state) {
            return playheadKey.getState(state)?.deco;
          },
        },
      }),
    ];
  },
});

// Helper per aggiornare il tempo dall'esterno (dal player video).
export function setPlayheadTime(editor: any, time: number) {
  if (!editor) return;
  const { state, view } = editor;
  view.dispatch(state.tr.setMeta(playheadKey, { time }));
}
