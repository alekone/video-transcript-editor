import { Mark, mergeAttributes } from "@tiptap/core";

// Taglio NON distruttivo: il testo non si cancella, si "barra". Le parole con
// questo mark sono escluse dal montaggio (e dal video in anteprima), ma
// restano nel documento → si possono ripristinare togliendo il mark.
export const Cut = Mark.create({
  name: "cut",
  inclusive: false,
  parseHTML() {
    return [{ tag: "span.cut" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "cut" }), 0];
  },

  // Backspace/Delete NON cancellano: barrano (taglio non distruttivo).
  // Su selezione: barra la selezione. Su cursore singolo: barra la parola
  // accanto SE è una parola del transcript (timing); altrimenti cancella
  // normalmente (così il testo digitato a mano resta cancellabile).
  addKeyboardShortcuts() {
    const strikeSelection = (editor: any) => {
      const { to } = editor.state.selection;
      return editor.chain().setMark("cut").setTextSelection(to).run();
    };
    const strikeWord = (editor: any, before: boolean) => {
      const sel = editor.state.selection;
      const node = before ? sel.$from.nodeBefore : sel.$from.nodeAfter;
      if (!node || !node.isText || !node.marks.some((m: any) => m.type.name === "timing")) return false;
      const from = before ? sel.from - node.nodeSize : sel.from;
      const end = before ? sel.from : sel.from + node.nodeSize;
      return editor
        .chain()
        .setTextSelection({ from, to: end })
        .setMark("cut")
        .setTextSelection(before ? from : end)
        .run();
    };
    return {
      Backspace: ({ editor }: any) =>
        editor.state.selection.empty ? strikeWord(editor, true) : strikeSelection(editor),
      Delete: ({ editor }: any) =>
        editor.state.selection.empty ? strikeWord(editor, false) : strikeSelection(editor),
    };
  },
});
