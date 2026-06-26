import { useState } from "react";
import { transcribeFile } from "./lib/transcribe";
import type { TranscriptWord } from "./types";

const ROOM = "trascrizione-demo";

// Timecode in mm:ss.cs (centesimi), comodo per il montaggio.
function tc(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export function Transcriber() {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [words, setWords] = useState<TranscriptWord[]>([]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("working");
    setError(null);
    setWords([]);
    try {
      const result = await transcribeFile(file, ROOM);
      setWords(result.words);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <section className="transcriber">
      <label className="upload">
        <input
          type="file"
          accept="audio/*,video/*"
          onChange={onPick}
          disabled={status === "working"}
        />
        {status === "working" ? "Trascrizione in corso…" : "Carica audio/video"}
      </label>

      {status === "error" && <p className="err">⚠ {error}</p>}

      {words.length > 0 && (
        <div className="words">
          <p className="hint">{words.length} parole con timecode:</p>
          <p>
            {words.map((w, i) => (
              <span key={i} className="w" title={`${tc(w.start)} → ${tc(w.end)}`}>
                {w.text}{" "}
              </span>
            ))}
          </p>
        </div>
      )}
    </section>
  );
}
