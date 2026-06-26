// Host del backend PartyKit. In dev il server locale, in prod il deploy
// (impostato a build-time via VITE_PARTYKIT_HOST).
export const PARTYKIT_HOST =
  import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";

// Gli host locali parlano http/ws; quelli remoti https/wss.
const isLocal = /^(127\.0\.0\.1|localhost)/.test(PARTYKIT_HOST);
export const PARTYKIT_HTTP = `${isLocal ? "http" : "https"}://${PARTYKIT_HOST}`;

// URL di un party HTTP per una data stanza.
export const partyUrl = (party: string, room: string) =>
  `${PARTYKIT_HTTP}/parties/${party}/${room}`;
