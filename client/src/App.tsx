import { Editor } from "./Editor";

// Il progetto (= stanza di collaborazione) è scelto dall'URL: ?doc=nome.
// Collaboratori che aprono lo stesso URL editano lo stesso documento.
function sanitizeDoc(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}
function currentDoc(): string {
  const raw = new URLSearchParams(location.search).get("doc");
  return (raw && sanitizeDoc(raw)) || "trascrizione-demo";
}

function openProject() {
  const name = prompt("Nome del progetto (condividi l'URL per collaborare):");
  if (!name) return;
  const doc = sanitizeDoc(name);
  if (doc) location.search = `?doc=${encodeURIComponent(doc)}`;
}

export function App() {
  const doc = currentDoc();
  return (
    <main>
      <h1>Editor trascrizioni — collaborativo</h1>
      <p className="hint">
        Trascrivi un video in locale con <code>trascrivi video.mp4</code>, importa
        il <code>transcript.json</code>, apri il video (resta in locale) ed edita in
        tempo reale. La parola in riproduzione si illumina; clicca una parola per
        saltare a quel punto del video.
      </p>
      <div className="projectbar">
        <span>
          Progetto: <strong>{doc}</strong>
        </span>
        <button className="btn" onClick={openProject}>Nuovo / cambia progetto</button>
        <span className="hint">— condividi questo URL per collaborare</span>
      </div>
      <Editor key={doc} documentName={doc} />
    </main>
  );
}
