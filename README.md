<div align="center">
  <img src="build/icon-512.png" width="128" alt="v-editor" />
  <h1>v-editor</h1>
  <p><strong>Editor di trascrizioni per content creator.</strong><br/>
  Trascrivi un video in locale, edita il <em>testo</em>, e il montaggio si fa da solo.</p>
</div>

---

Workflow tipo Descript, ma **locale, gratis e open source**. Trascrivi anche video da
10+ GB sul tuo Mac (nessun upload), edita la trascrizione come un documento, e i tagli
sul testo diventano un montaggio per **DaVinci Resolve / Premiere / Final Cut** — o
sottotitoli pronti.

Esiste in due forme dallo **stesso codice**:
- 🖥️ **App Mac** (Electron) — offline, con trascrizione integrata.
- 🌐 **Web** ([mininno.com/v-editor](https://mininno.com/v-editor)) — collaborativa in tempo reale.

## ✨ Feature

- **Trascrizione locale** con timecode a livello di parola (ffmpeg + whisper.cpp, Metal sul Mac) — gestisce file da 10+ GB
- **Diarizzazione**: riconosce *chi parla* e colora gli speaker (sherpa-onnx, nessun account)
- **Player sincronizzato**: la parola in riproduzione si illumina; clicca una parola per saltare lì
- **✂️ Rimozione filler** in un click (ehm, cioè, tipo…)
- **Taglio pause lunghe** automatico
- **★ Highlights**: marca i momenti top → esporta la "reel"
- **📊 Statistiche** talk-time per speaker
- **Rinomina speaker**, **cerca & sostituisci**, **velocità di riproduzione**, **dark mode**
- **Export**: EDL e FCPXML (montaggio), SRT e VTT (sottotitoli), TXT e Markdown (testo)
- **Persistenza locale** + cache (riapri un progetto trascritto all'istante)

## ⬇️ Download (Mac)

Scarica l'ultima `.dmg` dalla pagina **[Releases](../../releases)**, trascina l'app in
Applicazioni. Al primo avvio: **tasto destro → Apri** (app non notarizzata).

Prerequisiti per la trascrizione: `brew install ffmpeg whisper-cpp` e `python3`.

## 🚀 Uso

1. **Apri video** → **Trascrivi** (scegli il numero di speaker)
2. Edita: cancella le parti che non vuoi (le parole tenute conservano il timecode)
3. **Esporta**: EDL/FCPXML per il montaggio, SRT/VTT per i sottotitoli

## 🛠️ Sviluppo

```bash
npm install
npm run test --workspace=client   # 14 test (vitest)
npm run app:dev                    # app desktop in dev
npm run dist:mac                   # build .dmg → release/
```

Dettagli in [CONTRIBUTING.md](CONTRIBUTING.md).

## Architettura

| Pezzo | Tecnologia |
|---|---|
| Editor | React + TipTap (ProseMirror), timecode su ogni parola |
| Trascrizione | ffmpeg + whisper.cpp (locale) |
| Diarizzazione | sherpa-onnx (locale) |
| Desktop | Electron |
| Web realtime | Yjs + Hocuspocus (Render) |
| Export | EDL (CMX3600), FCPXML 1.10, SRT, VTT |

## Licenza

[MIT](LICENSE) © Flatmates
