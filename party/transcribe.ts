import type * as Party from "partykit/server";

// Endpoint HTTP di trascrizione: riceve un file audio/video, lo inoltra a
// OpenAI Whisper e restituisce le parole con i timecode. La API key vive
// come secret lato server (room.env.OPENAI_API_KEY), mai nel client.
//
// Rotta: POST /parties/transcribe/<id>   (multipart/form-data, campo "file")

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

export default class TranscribeServer implements Party.Server {
  constructor(readonly room: Party.Room) {}

  async onRequest(req: Party.Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return json({ error: "Usa POST" }, 405);

    const apiKey = this.room.env.OPENAI_API_KEY as string | undefined;
    if (!apiKey) {
      return json(
        { error: "OPENAI_API_KEY non configurata sul server PartyKit." },
        500
      );
    }

    let incoming: FormData;
    try {
      incoming = await req.formData();
    } catch {
      return json({ error: "Attesa una multipart/form-data con campo 'file'." }, 400);
    }

    const file = incoming.get("file");
    if (!(file instanceof File)) {
      return json({ error: "Campo 'file' mancante o non valido." }, 400);
    }
    // Limite hard di Whisper: 25 MB.
    if (file.size > 25 * 1024 * 1024) {
      return json(
        { error: `File troppo grande (${(file.size / 1e6).toFixed(1)} MB). Limite Whisper: 25 MB. Estrai/comprimi l'audio prima.` },
        413
      );
    }

    const form = new FormData();
    form.set("file", file, file.name || "audio");
    form.set("model", "whisper-1");
    form.set("response_format", "verbose_json");
    form.set("timestamp_granularities[]", "word");
    const language = incoming.get("language");
    if (typeof language === "string" && language) form.set("language", language);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const detail = await res.text();
      return json({ error: "Errore da OpenAI Whisper", status: res.status, detail }, 502);
    }

    const data = (await res.json()) as {
      text: string;
      language?: string;
      duration?: number;
      words?: { word: string; start: number; end: number }[];
    };

    const words = (data.words ?? []).map((w) => ({
      text: w.word,
      start: w.start,
      end: w.end,
    }));

    return json({
      text: data.text,
      words,
      language: data.language,
      duration: data.duration,
    });
  }
}
