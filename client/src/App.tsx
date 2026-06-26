import { Editor } from "./Editor";

export function App() {
  return (
    <main>
      <h1>Editor trascrizioni — collaborativo</h1>
      <p className="hint">
        Trascrivi un video in locale con <code>npm run transcribe -- video.mp4</code>,
        poi importa il <code>transcript.json</code> qui sotto ed edita il testo in
        tempo reale (apri in due tab per la collaborazione). Ogni parola conserva il
        suo timecode.
      </p>
      <Editor documentName="trascrizione-demo" />
    </main>
  );
}
