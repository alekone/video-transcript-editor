# video-transcript-editor

Micro-app per **sbobinare video con timecode → editare il testo in collaborazione (multi-utente) → montare automaticamente in DaVinci Resolve**.

Workflow tipo Descript: il testo trascritto è ancorato ai timecode; tagliando/spostando il testo le parole superstiti conservano i loro `start`/`end`, che diventano la base del montaggio.

## Architettura

| Pezzo | Tecnologia |
|---|---|
| Editing collaborativo realtime | Yjs (CRDT) + TipTap (ProseMirror) |
| Backend realtime | Hocuspocus (server Yjs) — deployato su Render da GitHub |
| Frontend | Vite + React + TypeScript |
| Trascrizione | **Locale** — ffmpeg + whisper.cpp (Metal sul Mac). Nessun upload: gestisce video da 10+ GB. Timecode a livello di parola |
| Ancoraggio timecode | Mark TipTap `timing` su ogni parola → sopravvive all'editing → base dell'EDL |
| Montaggio | DaVinci Resolve (fase 2: API Python o export FCPXML/OTIO/EDL) |

## Trascrizione di un video (locale)

I video reali sono enormi (10+ GB) e non si caricano da nessuna parte: la
trascrizione gira sul tuo Mac.

```bash
brew install ffmpeg whisper-cpp          # una volta sola
trascrivi /percorso/video.mp4 --lang it  # comando globale (npm link)
# → genera transcript.json (il modello large-v3-turbo si scarica al primo uso)
```

Poi apri l'editor e premi **"Importa transcript.json"**: ogni parola entra come
testo ancorato al suo timecode, editabile in collaborazione.

### Speaker (chi parla) — opzionale

Diarizzazione locale con sherpa-onnx (nessun account/token). Setup una volta:

```bash
python3 -m venv .venv && .venv/bin/pip install sherpa-onnx soundfile numpy
# modelli in models/diarization/: segmentation (pyannote-3.0) + embedding
#   (vedi gli URL delle release k2-fsa/sherpa-onnx)
```

Poi aggiungi `--speakers N` (numero di interlocutori noto) o `--speakers auto`:

```bash
trascrivi intervista.mp4 --lang it --speakers 2
```

Nell'editor ogni speaker ha un colore e una voce nella legenda; i turni vanno
a capo automaticamente.

## Sviluppo locale

```bash
npm install
npm run dev        # server realtime (:1234) + Vite client (:5173) insieme
# oppure separati:
npm run dev:server
npm run dev:client
```

Apri `http://localhost:5173/v-editor/` in due tab per vedere la collaborazione in tempo reale.

## Deploy

Il **backend realtime** si deploya da GitHub su **Render** (Blueprint `render.yaml`):
collega il repo su render.com → Blueprint → Apply. Ogni push rideploya il server e
fornisce un URL `wss://<nome>.onrender.com` (TLS automatico).

Il **client** è statico e viene pubblicato nella sottocartella `mininno.com/v-editor`
(repo `mininno.com`, script `deploy:veditor`).

```bash
# 1. configura l'URL del server Render per la build di produzione
cp client/.env.production.example client/.env.production
#    e imposta VITE_REALTIME_URL=wss://<nome>.onrender.com

# 2. pubblica il client sul sito
cd ../mininno.com && bun run deploy:veditor
```

## Stato

- [x] Editing collaborativo realtime (Yjs + TipTap + Hocuspocus), verificato in locale
- [x] Setup deploy statico isolato su `mininno.com/v-editor`
- [x] Trascrizione locale (ffmpeg + whisper.cpp) con timecode a livello di parola
- [x] Diarizzazione locale (sherpa-onnx): speaker a colori nell'editor
- [x] Import nel collaborativo: parole ancorate al timecode (mark `timing`)
- [x] Player video sincronizzato: evidenzia la parola corrente, click-per-saltare
- [x] Persistenza locale + export segmenti tenuti/tagliati con timecode
- [ ] URL per progetto (`?doc=`)
- [ ] Export/montaggio DaVinci Resolve dai timecode superstiti
