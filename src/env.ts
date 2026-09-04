import type { Db } from "./db/client";
import type { event, participant } from "./db/schema";

export type EventRow = typeof event.$inferSelect;
export type ParticipantRow = typeof participant.$inferSelect;

/** cookie から解決した「今リクエストしている人」。 */
export interface Viewer {
  participant: ParticipantRow | null;
  isOrganizer: boolean;
}

export interface AppEnv {
  Bindings: Env;
  Variables: {
    db: Db;
    event?: EventRow;
    viewer?: Viewer;
  };
}
