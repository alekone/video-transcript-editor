# Contribuire

Grazie per l'interesse! Questo progetto è open source (MIT).

## Setup

```bash
npm install
npm run test --workspace=client   # test (vitest)
npm run app:dev                    # app desktop (Electron) in sviluppo
npm run dev                        # versione web (client + server realtime)
```

## Struttura

- `client/` — editor React (Vite). Tutta la logica pura è in `client/src/lib/`
  ed è coperta da test (`*.test.ts`).
- `electron/` — wrapper desktop (main + preload).
- `server/` — server di sincronizzazione Yjs (solo per la versione web collaborativa).
- `scripts/` — pipeline di trascrizione locale (`transcribe.mjs`, `diarize.py`).

## Regole

- Aggiungi un test per ogni funzione pura nuova in `client/src/lib/`.
- `npm run test --workspace=client` e `npm run build:client` devono passare (lo verifica anche la CI).
- Commit chiari; PR con una descrizione di cosa e perché.
