import { Editor } from "./Editor";
import { Transcriber } from "./Transcriber";

export function App() {
  return (
    <main>
      <h1>Editor trascrizioni — collaborativo</h1>
      <p className="hint">
        Carica un file per trascriverlo con timecode, poi edita il testo in
        tempo reale (apri in due tab per vedere la collaborazione).
      </p>
      <Transcriber />
      <Editor documentName="trascrizione-demo" />
    </main>
  );
}
