import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
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
 * `(event_id, discord_user_id)` から、参加中の Participant を1件取得する。
 * `/e/:slug/discord` のリンク消費(計画5-3の状況 A)に使う。参加中の行は
 * 部分ユニークインデックス(3-3)により最大1件しか無い。取りやめ・削除済み
 * (`left_at` あり)は対象外。
 */
export async function findByDiscordUserId(
  db: Db,
  eventId: string,
  discordUserId: string,
) {
  const rows = await db
    .select()
    .from(participant)
    .where(
      and(
        eq(participant.eventId, eventId),
        eq(participant.discordUserId, discordUserId),
        isNull(participant.leftAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 複数イベントの中で、指定した Discord ユーザーが参加中の participant を
 * 持つイベント ID の集合を取得する。`/bandoff list` の「参加中」表示用
 * (計画4-4)。イベントごとに問い合わせず1回にまとめることで、D1 への
 * クエリ数を抑える。
 */
export async function findJoinedEventIds(
  db: Db,
  eventIds: string[],
  discordUserId: string,
): Promise<Set<string>> {
  if (eventIds.length === 0) {
    return new Set();
  }
  const rows = await db
    .select({ eventId: participant.eventId })
    .from(participant)
    .where(
      and(
        inArray(participant.eventId, eventIds),
        eq(participant.discordUserId, discordUserId),
        isNull(participant.leftAt),
      ),
    );
  return new Set(rows.map((row) => row.eventId));
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

export interface ParticipantExportSummary {
  id: string;
  displayName: string;
  instruments: string[];
  createdAt: number;
  /** 取りやめ・削除された日時(秒)。参加中なら null。 */
  leftAt: number | null;
}

/**
 * JSON エクスポート(`/export.json`)専用の参加者一覧。取りやめ・削除済みの
 * 参加者も `leftAt` 付きで含める(計画4-2: 曲の `proposedBy` 等が参照して
 * いるため、バックアップとして参照先を欠かさない)。`discordUserId` は
 * 含めない(計画8章: エクスポートに Discord ID を出さない)。
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

export interface LinkDiscordUserInput {
  eventId: string;
  participantId: string;
  discordUserId: string;
}

/**
 * 保留中の Discord 紐付け(計画5-1)を participant に反映する自動紐付け
 * (計画5-4)。対象が参加中・未紐付けで、同じイベントに同じ Discord ID の
 * 参加中の participant がいないときだけ `discord_user_id` を設定する。
 * 条件付き UPDATE 1文に判定と更新をまとめることで、確認から更新までの
 * 隙間による重複紐付けを防ぐ(`joinSlot` と同じ考え方)。砦として
 * 部分ユニークインデックスの違反例外も「紐付けなかった」に写像し、
 * 呼び出し側の操作全体を 500 にしない。
 */
export async function linkDiscordUser(
  db: Db,
  input: LinkDiscordUserInput,
): Promise<boolean> {
  try {
    const result = await db.run(sql`
      update participant
      set discord_user_id = ${input.discordUserId}
      where id = ${input.participantId}
        and event_id = ${input.eventId}
        and left_at is null
        and discord_user_id is null
        and not exists (
          select 1 from participant as other
          where other.event_id = ${input.eventId}
            and other.discord_user_id = ${input.discordUserId}
            and other.left_at is null
        )
    `);
    return result.meta.changes > 0;
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return false;
    }
    throw err;
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && /unique/i.test(err.message);
}

/**
 * 設定画面からの Discord 紐付け解除(計画5-6)。cookie(ログイン状態)は
 * 変えず、`discord_user_id` だけを外す。
 */
export async function unlinkDiscordUser(db: Db, participantId: string): Promise<void> {
  await db
    .update(participant)
    .set({ discordUserId: null })
    .where(eq(participant.id, participantId));
}
