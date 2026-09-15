import type { Db } from "./db/client";
import type { event, participant } from "./db/schema";

export type EventRow = typeof event.$inferSelect;
export type ParticipantRow = typeof participant.$inferSelect;

/**
 * 保留中の Discord 紐付け候補(セッション cookie の `d`/`dn` の組)。
 * `middleware/session.ts` の `SessionPayload` もこの形を使う。循環 import を
 * 避けるため、両者から参照される基点であるこのファイルに置く。
 */
export interface PendingDiscordLink {
  userId: string;
  nameHint: string;
}

/** cookie から解決した「今リクエストしている人」。 */
export interface Viewer {
  participant: ParticipantRow | null;
  isOrganizer: boolean;
  /** 未確定の Discord 紐付け候補(バナー表示・自動紐付けに使う)。 */
  pendingDiscord: PendingDiscordLink | null;
}

export interface AppEnv {
  Bindings: Env;
  Variables: {
    db: Db;
    event?: EventRow;
    viewer?: Viewer;
  };
}
