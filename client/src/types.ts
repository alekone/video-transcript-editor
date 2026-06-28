// Modello dati condiviso tra endpoint di trascrizione e client.
// Ogni parola porta il proprio timecode in secondi: è la base che,
// sopravvivendo all'editing, diventerà l'EDL per DaVinci Resolve.
export interface TranscriptWord {
  text: string;
  start: number; // secondi
  end: number; // secondi
  speaker?: string; // es. "SPEAKER_00" (presente solo se diarizzato)
}

export interface TranscriptResult {
  text: string;
  words: TranscriptWord[];
  language?: string;
  duration?: number; // secondi
  source?: string; // nome del file video originale
  fps?: number; // frame rate rilevato (per l'export EDL/FCPXML)
}
