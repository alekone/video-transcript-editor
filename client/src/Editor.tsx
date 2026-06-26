import { useEffect, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import YPartyKitProvider from "y-partykit/provider";
import * as Y from "yjs";
import { PARTYKIT_HOST } from "./lib/partykit";

const COLORS = ["#f783ac", "#4dabf7", "#69db7c", "#ffd43b", "#9775fa", "#ff922b"];
const randomName = () => `Utente ${Math.floor(Math.random() * 1000)}`;
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

export function Editor({ documentName }: { documentName: string }) {
  const { ydoc, provider } = useMemo(() => {
    const ydoc = new Y.Doc();
    const provider = new YPartyKitProvider(PARTYKIT_HOST, documentName, ydoc);
    return { ydoc, provider };
  }, [documentName]);

  useEffect(() => () => provider.destroy(), [provider]);

  const editor = useEditor({
    extensions: [
      // history disabilitata: la gestisce Yjs/Collaboration.
      StarterKit.configure({ history: false }),
      Collaboration.configure({ document: ydoc }),
      CollaborationCursor.configure({
        provider,
        user: { name: randomName(), color: randomColor() },
      }),
    ],
  });

  if (!editor) return <p>Caricamento editor…</p>;

  return (
    <div className="editor">
      <EditorContent editor={editor} />
    </div>
  );
}
