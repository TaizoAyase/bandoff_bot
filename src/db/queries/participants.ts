import { and, asc, eq } from "drizzle-orm";
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
 * 登録フォーム・プロフィール編集フォームの重複警告に使う。
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

/**
 * `(event_id, recovery_key_hash)` から Participant を1件取得する。
 * 引き継ぎコードによる復旧(`/recover`)に使う。
 */
export async function findByRecoveryKeyHash(
  db: Db,
  eventId: string,
  recoveryKeyHash: string,
) {
  const rows = await db
    .select()
    .from(participant)
    .where(
      and(
        eq(participant.eventId, eventId),
        eq(participant.recoveryKeyHash, recoveryKeyHash),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 引き継ぎコードによる復旧時に、新しく発行した端末トークンのハッシュへ置き換える。
 * 旧トークンのハッシュはどの participant とも一致しなくなるため、
 * 以後 `/session/rebind` に旧トークンを渡しても 401 になる。
 */
export async function updateParticipantTokenHash(
  db: Db,
  participantId: string,
  tokenHash: string,
): Promise<void> {
  await db
    .update(participant)
    .set({ tokenHash })
    .where(eq(participant.id, participantId));
}

export interface UpdateProfileInput {
  displayName: string;
  instruments: string[];
}

/** `/settings/profile` からの表示名・持ち込み楽器の編集。 */
export async function updateProfile(
  db: Db,
  participantId: string,
  input: UpdateProfileInput,
): Promise<void> {
  await db
    .update(participant)
    .set({ displayName: input.displayName, instruments: input.instruments })
    .where(eq(participant.id, participantId));
}

export interface ParticipantSummary {
  id: string;
  displayName: string;
  instruments: string[];
  discordUserId: string | null;
  createdAt: number;
}

/**
 * イベント内の参加者一覧を `created_at` 昇順で取得する。
 * 参加者一覧画面・主催者の代理エントリー選択・JSON エクスポートで使う。
 */
export async function listParticipants(
  db: Db,
  eventId: string,
): Promise<ParticipantSummary[]> {
  return db
    .select({
      id: participant.id,
      displayName: participant.displayName,
      instruments: participant.instruments,
      discordUserId: participant.discordUserId,
      createdAt: participant.createdAt,
    })
    .from(participant)
    .where(eq(participant.eventId, eventId))
    .orderBy(asc(participant.createdAt));
}
