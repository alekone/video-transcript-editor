import { Mark, mergeAttributes } from "@tiptap/core";

// Mark per evidenziare i momenti "top": dalle parole evidenziate si esporta
// la highlights reel. Toggle sulla selezione.
export const Highlight = Mark.create({
  name: "highlight",
  parseHTML() {
    return [{ tag: "mark.hl" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes, { class: "hl" }), 0];
  },
  addCommands() {
    return {
      toggleHighlight:
        () =>
        ({ commands }: any) =>
          commands.toggleMark(this.name),
    } as any;
  },
});
