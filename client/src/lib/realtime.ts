// Endpoint del server di sincronizzazione Yjs (Hocuspocus).
// Dev: server locale (npm run dev:server). Prod: il servizio Render,
// impostato a build-time via VITE_REALTIME_URL (es. wss://v-editor-realtime.onrender.com).
export const REALTIME_URL =
  import.meta.env.VITE_REALTIME_URL ?? "ws://127.0.0.1:1234";
