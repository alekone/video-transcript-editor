import type { TranscriptWord } from "../types";

// Parole riempitive da rimuovere in un click (IT + qualche EN comune).
export const FILLER_WORDS = new Set([
  "ehm", "eh", "ehmm", "uhm", "uh", "mmh", "mmm", "boh",
  "cioè", "tipo", "insomma", "praticamente", "diciamo",
  "um", "uhh", "hmm", "like",
]);

// Normalizza una parola per il confronto (minuscolo, senza punteggiatura).
export function normalizeWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?…;:"«»()]/g, "")
    .trim();
}

export function isFiller(text: string): boolean {
  return FILLER_WORDS.has(normalizeWord(text));
}

// Soglia "pausa lunga" suggerita: analizza i gap tra parole e propone un
// valore che isola le pause anomale (mediana dei gap + margine), con un
// minimo di 0.5s. Così l'utente non deve indovinare il numero.
export function suggestPauseThreshold(words: TranscriptWord[]): number {
  const gaps: number[] = [];
  const sorted = [...words].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i].start - sorted[i - 1].end;
    if (g > 0) gaps.push(g);
  }
  if (gaps.length < 5) return 1;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  const p90 = gaps[Math.floor(gaps.length * 0.9)];
  // a metà tra il 90° percentile e una soglia "naturale" sopra la mediana
  const t = Math.max(0.5, Math.min(p90, median + 0.6));
  return Math.round(t * 10) / 10;
}

export interface SpeakerStat {
  speaker: string;
  words: number;
  duration: number; // secondi di parlato
  pct: number; // % sul parlato totale
}

export interface Stats {
  totalWords: number;
  totalDuration: number; // estensione (ultimo end − primo start)
  speakingDuration: number; // somma dei (end−start) delle parole
  speakers: SpeakerStat[];
}

// Statistiche: talk-time per speaker, durata, conteggio parole.
export function computeStats(words: TranscriptWord[]): Stats {
  const empty: Stats = { totalWords: 0, totalDuration: 0, speakingDuration: 0, speakers: [] };
  if (!words.length) return empty;
  const bySpeaker = new Map<string, { words: number; duration: number }>();
  let speaking = 0;
  let minStart = Infinity;
  let maxEnd = 0;
  for (const w of words) {
    const d = Math.max(0, w.end - w.start);
    speaking += d;
    minStart = Math.min(minStart, w.start);
    maxEnd = Math.max(maxEnd, w.end);
    const key = w.speaker ?? "—";
    const e = bySpeaker.get(key) ?? { words: 0, duration: 0 };
    e.words += 1;
    e.duration += d;
    bySpeaker.set(key, e);
  }
  const speakers: SpeakerStat[] = [...bySpeaker.entries()]
    .map(([speaker, v]) => ({
      speaker,
      words: v.words,
      duration: v.duration,
      pct: speaking > 0 ? (v.duration / speaking) * 100 : 0,
    }))
    .sort((a, b) => b.duration - a.duration);
  return {
    totalWords: words.length,
    totalDuration: maxEnd - minStart,
    speakingDuration: speaking,
    speakers,
  };
}
