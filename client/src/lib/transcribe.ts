import type { TranscriptResult } from "../types";
import { partyUrl } from "./partykit";

// Invia un file audio/video all'endpoint PartyKit e ottiene le parole
// con i timecode. `room` instrada verso un'istanza del party (riusiamo
// il nome del documento).
export async function transcribeFile(
  file: File,
  room: string,
  opts: { language?: string } = {}
): Promise<TranscriptResult> {
  const form = new FormData();
  form.set("file", file);
  if (opts.language) form.set("language", opts.language);

  const res = await fetch(partyUrl("transcribe", room), {
    method: "POST",
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error ?? `Trascrizione fallita (HTTP ${res.status})`);
  }
  return data as TranscriptResult;
}
