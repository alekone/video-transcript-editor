import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import YPartyKitProvider from "y-partykit/provider";
import * as Y from "yjs";
import { PARTYKIT_HOST } from "./lib/partykit";
import { Timing } from "./extensions/Timing";
import type { TranscriptResult, TranscriptWord } from "./types";

const COLORS = ["#f783ac", "#4dabf7", "#69db7c", "#ffd43b", "#9775fa", "#ff922b"];
const randomName = () => `Utente ${Math.floor(Math.random() * 1000)}`;
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

// transcript.json (parole con timecode) → documento ProseMirror in cui ogni
// parola è testo con il mark `timing`. Una frase = un paragrafo (split sulla
// punteggiatura forte) per un editing più comodo.
function wordsToDoc(words: TranscriptWord[]) {
  const paragraphs: TranscriptWord[][] = [[]];
  for (const w of words) {
    paragraphs[paragraphs.length - 1].push(w);
    if (/[.!?…]$/.test(w.text)) paragraphs.push([]);
  }
  const content = paragraphs
    .filter((p) => p.length > 0)
    .map((p) => ({
      type: "paragraph",
      content: p.map((w) => ({
        type: "text",
        text: w.text + " ",
        marks: [{ type: "timing", attrs: { start: w.start, end: w.end } }],
      })),
    }));
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

export function Editor({ documentName }: { documentName: string }) {
  const [imported, setImported] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { ydoc, provider } = useMemo(() => {
    const ydoc = new Y.Doc();
    const provider = new YPartyKitProvider(PARTYKIT_HOST, documentName, ydoc);
    return { ydoc, provider };
  }, [documentName]);

  useEffect(() => () => provider.destroy(), [provider]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      Timing,
      Collaboration.configure({ document: ydoc }),
      CollaborationCursor.configure({
        provider,
        user: { name: randomName(), color: randomColor() },
      }),
    ],
  });

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    setError(null);
    try {
      const data = JSON.parse(await file.text()) as TranscriptResult;
      if (!Array.isArray(data.words)) throw new Error("transcript.json senza campo 'words'");
      editor.commands.setContent(wordsToDoc(data.words));
      setImported(data.words.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!editor) return <p>Caricamento editor…</p>;

  return (
    <div>
      <div className="toolbar">
        <label className="upload">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={onImport}
          />
          Importa transcript.json
        </label>
        {imported != null && <span className="ok">✓ {imported} parole importate</span>}
        {error && <span className="err">⚠ {error}</span>}
      </div>
      <div className="editor">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
