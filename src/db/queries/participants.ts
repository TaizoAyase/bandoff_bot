import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../client";
import { assignment, participant, slot, song, take } from "../schema";

export type CreateParticipantInput = typeof participant.$inferInsert;

/** Participant を1件作成する。 */
export async function createParticipant(
  db: Db,
  input: CreateParticipantInput,
): Promise<void> {
  await db.insert(participant).values(input);
}

/**
 * id から Participant を1件取得する。存在しない、または取りやめ・削除済み
 * (`left_at` あり)なら null(計画4-2: 代理エントリーの対象・一括辞退の対象・
 * 削除の対象から除外する)。
 */
export async function findParticipantById(db: Db, id: string) {
  const rows = await db
    .select()
    .from(participant)
    .where(and(eq(participant.id, id), isNull(participant.leftAt)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 端末トークンのハッシュから Participant を1件取得する。存在しない、
 * または取りやめ・削除済みなら null(計画4-2: `/session/rebind` は 401)。
 */
export async function findByTokenHash(db: Db, tokenHash: string) {
  const rows = await db
    .select()
    .from(participant)
    .where(and(eq(participant.tokenHash, tokenHash), isNull(participant.leftAt)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 同一イベント内で表示名が完全一致する既存参加者を1件取得する。
 * 登録フォーム・プロフィール編集フォームの重複警告に使う。取りやめ・
 * 削除済みの参加者は除外する(計画4-2: 同じ名前で登録し直しても警告しない)。
 */
export async function findByDisplayName(db: Db, eventId: string, displayName: string) {
  const rows = await db
    .select()
    .from(participant)
    .where(
      and(
        eq(participant.eventId, eventId),
        eq(participant.displayName, displayName),
        isNull(participant.leftAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * `(event_id, recovery_key_hash)` から Participant を1件取得する。
 * 引き継ぎコードによる復旧(`/recover`)に使う。取りやめ・削除済みの
 * 参加者は除外する(計画4-2: 既存どおり「引き継ぎコードが違います」401)。
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
        isNull(participant.leftAt),
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
 * 参加者一覧画面・主催者の代理エントリー選択で使う。取りやめ・削除済みの
 * 参加者は除外する(計画4-2)。JSON エクスポートは取りやめた人も含める
 * 必要があるため、代わりに `listParticipantsForExport` を使うこと。
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
    .where(and(eq(participant.eventId, eventId), isNull(participant.leftAt)))
    .orderBy(asc(participant.createdAt));
}

export interface ParticipantExportSummary extends ParticipantSummary {
  /** 取りやめ・削除された日時(秒)。参加中なら null。 */
  leftAt: number | null;
}

/**
 * JSON エクスポート(`/export.json`)専用の参加者一覧。取りやめ・削除済みの
 * 参加者も `leftAt` 付きで含める(計画4-2: 曲の `proposedBy` 等が参照して
 * いるため、バックアップとして参照先を欠かさない)。
 */
export async function listParticipantsForExport(
  db: Db,
  eventId: string,
): Promise<ParticipantExportSummary[]> {
  return db
    .select({
      id: participant.id,
      displayName: participant.displayName,
      instruments: participant.instruments,
      discordUserId: participant.discordUserId,
      createdAt: participant.createdAt,
      leftAt: participant.leftAt,
    })
    .from(participant)
    .where(eq(participant.eventId, eventId))
    .orderBy(asc(participant.createdAt));
}

export interface WithdrawParticipantInput {
  eventId: string;
  participantId: string;
  now: number;
}

/**
 * 参加の取りやめ・主催者による削除の本体。物理削除はせず `left_at` に
 * 印を付け、その participant の全エントリーをまとめて削除する
 * (計画4-1)。D1 は `db.transaction()` を使えないため `db.batch()` で
 * 2文をまとめ、片方だけ適用される状態を防ぐ。
 * `left_at is null` の条件により、既に取りやめ済みの participant に
 * 対しては更新が0件になる(戻り値 `false`)。同時に二重送信されたときに
 * 通知やエントリー削除を2回走らせないための歯止め。
 * 曲・Take・枠(`proposed_by` / `created_by`)は触らない。
 */
export async function withdrawParticipant(
  db: Db,
  input: WithdrawParticipantInput,
): Promise<boolean> {
  // D1 の db.batch() は各文をクエリビルダの prepared statement として
  // まとめて送る。db.run(sql`...`) はこの prepared statement を持たない
  // ため、batch に混ぜると実行時エラーになる(型チェックは通る)。
  // そのため削除側も同じ inArray(subquery) の形でクエリビルダとして書く。
  const eventSlotIds = db
    .select({ id: slot.id })
    .from(slot)
    .innerJoin(take, eq(take.id, slot.takeId))
    .innerJoin(song, eq(song.id, take.songId))
    .where(eq(song.eventId, input.eventId));

  const [updateResult] = await db.batch([
    db
      .update(participant)
      .set({ leftAt: input.now })
      .where(
        and(
          eq(participant.id, input.participantId),
          eq(participant.eventId, input.eventId),
          isNull(participant.leftAt),
        ),
      ),
    db
      .delete(assignment)
      .where(
        and(
          eq(assignment.participantId, input.participantId),
          inArray(assignment.slotId, eventSlotIds),
        ),
      ),
  ]);
  return (updateResult?.meta.changes ?? 0) > 0;
}
