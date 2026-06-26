import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";

// Una "stanza" = una trascrizione. PartyKit gestisce il documento Yjs
// condiviso e l'awareness (cursori multi-utente) e lo persiste tra le sessioni.
export default class TranscriptServer implements Party.Server {
  constructor(readonly room: Party.Room) {}

  async onConnect(conn: Party.Connection) {
    return onConnect(conn, this.room, {
      // Snapshot del documento Yjs nello storage di PartyKit: la trascrizione
      // sopravvive anche quando tutti gli utenti si disconnettono.
      persist: { mode: "snapshot" },
    });
  }
}
