import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../client";
import { event, participant } from "../schema";

/** slug からイベントを1件取得する。存在しなければ null。 */
export async function findEventBySlug(db: Db, slug: string) {
  const rows = await db.select().from(event).where(eq(event.slug, slug)).limit(1);
  return rows[0] ?? null;
}

/**
 * id からイベントを1件取得する。存在しなければ null。Discord の
 * `/bandoff open`・ボタン押下では、slug ではなくイベント ID がやり取り
 * されるため slug 解決とは別にこちらを使う(計画4-4)。
 */
export async function findEventById(db: Db, id: string) {
  const rows = await db.select().from(event).where(eq(event.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface DiscordCandidateEvent {
  id: string;
  slug: string;
  title: string;
  region: string;
  place: string;
  startsAt: number;
}

/**
 * `/bandoff open` のオートコンプリート・`/bandoff list` の候補イベント
 * (計画4-4)。`discord_enabled` かつ `starts_at + 86400 >= now`
 * (`isPast24h` が false と同値。ちょうど86400秒は含む)。締切(closed)も
 * 含む。`starts_at` 昇順で最大25件。
 */
export async function listDiscordCandidateEvents(
  db: Db,
  now: number,
): Promise<DiscordCandidateEvent[]> {
  return db
    .select({
      id: event.id,
      slug: event.slug,
      title: event.title,
      region: event.region,
      place: event.place,
      startsAt: event.startsAt,
    })
    .from(event)
    .where(
      and(eq(event.discordEnabled, true), sql`${event.startsAt} + 86400 >= ${now}`),
    )
    .orderBy(asc(event.startsAt))
    .limit(25);
}

export interface CreateEventInput {
  eventId: string;
  workspaceId: string;
  slug: string;
  title: string;
  region: string;
  startsAt: number;
  durationMinutes: number | null;
  place: string;
  notes: string;
  joinCode: string;
  organizerKeyHash: string;
  organizerParticipantId: string;
  organizerDisplayName: string;
  organizerInstruments: string[];
  organizerTokenHash: string;
  organizerRecoveryKeyHash: string;
  discordEnabled: boolean;
  now: number;
}

/**
 * イベントと主催者の Participant を原子的に作成する。
 * event ↔ participant は循環参照のため、
 * 1. organizer_participant_id = NULL で event を作成
 * 2. 主催者の participant を作成
 * 3. event.organizer_participant_id を更新
 * の3文を `db.batch()` でまとめて実行する(D1 では `db.transaction()` が使えないため)。
 */
export async function createEvent(db: Db, input: CreateEventInput): Promise<void> {
  await db.batch([
    db.insert(event).values({
      id: input.eventId,
      workspaceId: input.workspaceId,
      slug: input.slug,
      title: input.title,
      region: input.region,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
      place: input.place,
      notes: input.notes === "" ? null : input.notes,
      status: "upcoming",
      joinCode: input.joinCode,
      organizerKeyHash: input.organizerKeyHash,
      organizerParticipantId: null,
      discordEnabled: input.discordEnabled,
      createdAt: input.now,
      updatedAt: input.now,
    }),
    db.insert(participant).values({
      id: input.organizerParticipantId,
      eventId: input.eventId,
      displayName: input.organizerDisplayName,
      instruments: input.organizerInstruments,
      tokenHash: input.organizerTokenHash,
      recoveryKeyHash: input.organizerRecoveryKeyHash,
      discordUserId: null,
      createdAt: input.now,
    }),
    db
      .update(event)
      .set({ organizerParticipantId: input.organizerParticipantId })
      .where(eq(event.id, input.eventId)),
  ]);
}

export interface UpdateEventInput {
  title: string;
  region: string;
  startsAt: number;
  durationMinutes: number | null;
  place: string;
  notes: string;
  status: "upcoming" | "closed";
  discordEnabled: boolean;
  updatedAt: number;
}

/**
 * 主催者画面からのイベント情報編集
 * (タイトル・地域・日時・長さ・場所・備考・status・discordEnabled)。
 */
export async function updateEvent(
  db: Db,
  eventId: string,
  input: UpdateEventInput,
): Promise<void> {
  await db
    .update(event)
    .set({
      title: input.title,
      region: input.region,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
      place: input.place,
      notes: input.notes === "" ? null : input.notes,
      status: input.status,
      discordEnabled: input.discordEnabled,
      updatedAt: input.updatedAt,
    })
    .where(eq(event.id, eventId));
}

/**
 * `since`(UTC エポック秒)以降に作られたイベント数を、イベントに
 * 絞り込まずサイト全体で数える(新規イベント通知のレート制限用)。
 */
export async function countEventsCreatedSince(db: Db, since: number): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(event)
    .where(gte(event.createdAt, since));
  return rows[0]?.count ?? 0;
}
