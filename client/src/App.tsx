import { useEffect, useState } from "react";
import { Editor } from "./Editor";
import { isElectron, electronAPI } from "./lib/platform";

function sanitizeDoc(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

// Progetto attivo: in Electron via localStorage (riapre l'ultimo all'avvio);
// nel web via URL ?doc (condivisibile per collaborare).
function currentDoc(): string {
  if (isElectron) return localStorage.getItem("vte-project") || "progetto-1";
  const raw = new URLSearchParams(location.search).get("doc");
  return (raw && sanitizeDoc(raw)) || "trascrizione-demo";
}
function switchDoc(slug: string) {
  if (!slug) return;
  if (isElectron) {
    localStorage.setItem("vte-project", slug);
    location.reload();
  } else {
    location.search = `?doc=${encodeURIComponent(slug)}`;
  }
}

export function App() {
  const doc = currentDoc();
  const [name, setName] = useState(doc);
  const [recent, setRecent] = useState<{ name: string; mtime: number }[]>([]);

  useEffect(() => {
    if (isElectron) electronAPI!.listProjects().then(setRecent).catch(() => {});
  }, []);

  function commit() {
    const slug = sanitizeDoc(name);
    if (slug && slug !== doc) switchDoc(slug);
  }

  return (
    <main>
      <div className="titlebar">
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
        <button className="btn ghost" onClick={() => switchDoc(`progetto-${Date.now().toString(36)}`)} title="Nuovo progetto vuoto">+ Nuovo</button>
        {isElectron && recent.length > 0 && (
          <select
            className="recent"
            value=""
            onChange={(e) => e.target.value && switchDoc(e.target.value)}
            title="Progetti recenti"
          >
            <option value="">Recenti…</option>
            {recent.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        )}
      </div>
      <Editor key={doc} documentName={doc} />
    </main>
  );
}
