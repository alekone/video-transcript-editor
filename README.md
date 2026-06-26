# video-transcript-editor

Micro-app per **sbobinare video con timecode → editare il testo in collaborazione (multi-utente) → montare automaticamente in DaVinci Resolve**.

Workflow tipo Descript: il testo trascritto è ancorato ai timecode; tagliando/spostando il testo le parole superstiti conservano i loro `start`/`end`, che diventano la base del montaggio.

## Architettura

| Pezzo | Tecnologia |
|---|---|
| Editing collaborativo realtime | Yjs (CRDT) + TipTap (ProseMirror) |
| Backend realtime + (futuro) trascrizione | PartyKit (servizio gestito) |
| Frontend | Vite + React + TypeScript |
| Trascrizione | OpenAI `whisper-1` con timecode a livello di parola (adapter intercambiabile → whisper.cpp locale) |
| Montaggio | DaVinci Resolve (fase 2: API Python o export FCPXML/OTIO/EDL) |

## Sviluppo locale

```bash
npm install
npm run dev        # PartyKit (:1999) + Vite client (:5173) insieme
# oppure separati:
npm run dev:party
npm run dev:client
```

Apri `http://localhost:5173/v-editor/` in due tab per vedere la collaborazione in tempo reale.

## Deploy

Il **client** è statico e viene pubblicato nella sottocartella `mininno.com/v-editor`
(repo `mininno.com`, script `deploy:veditor`). Il **backend** gira su PartyKit cloud.

```bash
# 1. backend realtime (richiede login PartyKit/Cloudflare)
npm run deploy:party                       # → v-editor.<username>.partykit.dev

# 2. configura l'host per la build di produzione
cp client/.env.production.example client/.env.production
#    e imposta VITE_PARTYKIT_HOST=v-editor.<username>.partykit.dev

# 3. pubblica il client sul sito
cd ../mininno.com && bun run deploy:veditor
```

## Stato

- [x] Editing collaborativo realtime (Yjs + TipTap + PartyKit), verificato in locale
- [x] Setup deploy statico isolato su `mininno.com/v-editor`
- [ ] Endpoint di trascrizione Whisper su PartyKit
- [ ] Nodo `Word` con timecode + player video sincronizzato
- [ ] Export/montaggio DaVinci Resolve
