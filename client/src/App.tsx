import { Editor } from "./Editor";

export function App() {
  return (
    <main>
      <h1>Editor trascrizioni — collaborativo</h1>
      <p className="hint">
        Apri questa pagina in due tab: le modifiche si sincronizzano in tempo
        reale. Prossimo step: parole con timecode dalla trascrizione Whisper.
      </p>
      <Editor documentName="trascrizione-demo" />
    </main>
  );
}
