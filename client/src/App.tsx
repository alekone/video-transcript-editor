import { useState } from "react";
import { Editor } from "./Editor";

// Il progetto (= stanza/URL) è scelto dall'URL: ?doc=nome.
function sanitizeDoc(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}
function currentDoc(): string {
  const raw = new URLSearchParams(location.search).get("doc");
  return (raw && sanitizeDoc(raw)) || "trascrizione-demo";
}

export function App() {
  const doc = currentDoc();
  const [name, setName] = useState(doc);

  function commit() {
    const slug = sanitizeDoc(name);
    if (slug && slug !== doc) location.search = `?doc=${encodeURIComponent(slug)}`;
  }

  return (
    <main>
      <input
        className="project-title"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        onBlur={commit}
        placeholder="Nome del progetto"
        aria-label="Nome del progetto"
        spellCheck={false}
      />
      <Editor key={doc} documentName={doc} />
    </main>
  );
}
