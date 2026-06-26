import { Hocuspocus } from "@hocuspocus/server";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";

// Server di sincronizzazione Yjs (collaborazione realtime dell'editor).
// Pensato per girare su Render: ascolta su process.env.PORT ed espone un
// endpoint HTTP "/" per l'health check, oltre al WebSocket per Hocuspocus.
const port = Number(process.env.PORT ?? 1234);

const hocuspocus = new Hocuspocus({
  // Nessuna persistenza: i documenti vivono in memoria finché il server è su.
  // La trascrizione è comunque re-importabile da transcript.json.
});

const httpServer = createServer((req, res) => {
  // Health check di Render (GET /) + risposta umana.
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("v-editor realtime ok\n");
});

const wss = new WebSocketServer({ server: httpServer });
wss.on("connection", (websocket, request) => {
  hocuspocus.handleConnection(websocket, request);
});

httpServer.listen(port, () => {
  console.log(`Realtime (Hocuspocus) in ascolto su :${port}`);
});
