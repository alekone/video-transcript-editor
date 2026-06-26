import { Editor } from "./Editor";

export function App() {
  return (
    <main>
      <h1>Editor trascrizioni — collaborativo</h1>
      <p className="hint">
        Trascrivi un video in locale con <code>npm run transcribe -- video.mp4</code>,
        importa il <code>transcript.json</code>, apri il video (resta in locale) ed
        edita in tempo reale. La parola in riproduzione si illumina; clicca una
        parola per saltare a quel punto del video.
      </p>
      <Editor documentName="trascrizione-demo" />
    </main>
  );
}
