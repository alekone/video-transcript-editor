// Rileva se l'app gira dentro Electron (app Mac) o nel browser (web).
// In Electron il preload espone window.electronAPI; nel web è assente.

export interface ElectronAPI {
  // Apre un dialog nativo e ritorna il path del video scelto (o null).
  openVideo: () => Promise<string | null>;
  // URL riproducibile per un path locale (protocollo custom con range).
  mediaUrl: (path: string) => string;
  // Trascrive un video in locale (whisper.cpp + diarizzazione) e ritorna
  // il transcript. onProgress riceve le righe di avanzamento.
  transcribe: (
    videoPath: string,
    opts: { lang?: string; speakers?: string; force?: boolean }
  ) => Promise<(import("../types").TranscriptResult & { cached?: boolean }) | null>;
  // Salva/carica un progetto (.vte.json) su disco.
  saveProject: (data: unknown, suggestedName: string) => Promise<string | null>;
  loadProject: () => Promise<unknown | null>;
  onTranscribeProgress: (cb: (line: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export const electronAPI: ElectronAPI | undefined =
  typeof window !== "undefined" ? window.electronAPI : undefined;
export const isElectron = !!electronAPI;
