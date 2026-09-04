import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { participant } from "../schema";

export type CreateParticipantInput = typeof participant.$inferInsert;

/** Participant を1件作成する。 */
export async function createParticipant(
  db: Db,
  input: CreateParticipantInput,
): Promise<void> {
  await db.insert(participant).values(input);
}

/** id から Participant を1件取得する。存在しなければ null。 */
export async function findParticipantById(db: Db, id: string) {
  const rows = await db
    .select()
    .from(participant)
    .where(eq(participant.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** 端末トークンのハッシュから Participant を1件取得する。存在しなければ null。 */
export async function findByTokenHash(db: Db, tokenHash: string) {
  const rows = await db
    .select()
    .from(participant)
    .where(eq(participant.tokenHash, tokenHash))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 同一イベント内で表示名が完全一致する既存参加者を1件取得する。
 * 登録フォームの重複警告に使う。
 */
export async function findByDisplayName(db: Db, eventId: string, displayName: string) {
  const rows = await db
    .select()
    .from(participant)
    .where(
      and(eq(participant.eventId, eventId), eq(participant.displayName, displayName)),
    )
    .limit(1);
  return rows[0] ?? null;
}
