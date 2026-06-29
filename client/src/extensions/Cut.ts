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
});
