import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import YPartyKitProvider from "y-partykit/provider";
import * as Y from "yjs";
import { PARTYKIT_HOST } from "./lib/partykit";
import { Timing } from "./extensions/Timing";
import { Playhead, setPlayheadTime } from "./extensions/Playhead";
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
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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
      Playhead,
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

  // Il video resta in locale: object URL, nessun upload (regge file da 10+ GB).
  function onPickVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }
  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  // Riproduzione → evidenzia la parola corrente.
  function onTimeUpdate() {
    if (videoRef.current) setPlayheadTime(editor, videoRef.current.currentTime);
  }

  // Click su una parola → salta a quel punto del video.
  function onEditorClick(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest(".w") as HTMLElement | null;
    const start = el?.dataset.start;
    if (start != null && videoRef.current) {
      videoRef.current.currentTime = Number(start);
      void videoRef.current.play();
    }
  }

  if (!editor) return <p>Caricamento editor…</p>;

  return (
    <div>
      <div className="toolbar">
        <label className="upload">
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onImport} />
          Importa transcript.json
        </label>
        <label className="upload">
          <input type="file" accept="video/*,audio/*" onChange={onPickVideo} />
          Apri video
        </label>
        {imported != null && <span className="ok">✓ {imported} parole importate</span>}
        {error && <span className="err">⚠ {error}</span>}
      </div>

      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          className="player"
          onTimeUpdate={onTimeUpdate}
        />
      )}

      <div className="editor" onClick={onEditorClick}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
