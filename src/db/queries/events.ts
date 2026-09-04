import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { event, participant } from "../schema";

/** slug からイベントを1件取得する。存在しなければ null。 */
export async function findEventBySlug(db: Db, slug: string) {
  const rows = await db.select().from(event).where(eq(event.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export interface CreateEventInput {
  eventId: string;
  workspaceId: string;
  slug: string;
  title: string;
  region: string;
  startsAt: number;
  place: string;
  notes: string;
  joinCode: string;
  organizerPwHash: string;
  organizerParticipantId: string;
  organizerDisplayName: string;
  organizerInstruments: string[];
  organizerTokenHash: string;
  organizerRecoveryKeyHash: string;
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
      place: input.place,
      notes: input.notes === "" ? null : input.notes,
      status: "upcoming",
      joinCode: input.joinCode,
      organizerPwHash: input.organizerPwHash,
      organizerParticipantId: null,
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
