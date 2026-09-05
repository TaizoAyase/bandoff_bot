import { and, eq, sql } from "drizzle-orm";
import { newId } from "../../domain/ids";
import type { Db } from "../client";
import {
  assignment,
  participant as participantTable,
  slot,
  song,
  take,
} from "../schema";

export interface JoinSlotInput {
  slotId: string;
  participantId: string;
  now: number;
}

export type JoinSlotResult =
  | { kind: "joined"; assignmentId: string }
  | { kind: "taken" };

/**
 * 枠への条件付きエントリー。仕様 9.5(350〜356行目)の
 * `INSERT ... SELECT ... WHERE NOT EXISTS` を1文で実行することで、
 * 「空きを確認してから挿入する」の隙間による二重登録を防ぐ。
 * 挿入行数が0(=既に埋まっていた)なら `{kind: "taken"}`。
 * 通常この条件付き INSERT が UNIQUE 制約に触れることはないが、
 * 砦として UNIQUE 違反の例外も同じ `{kind: "taken"}` に写像する。
 */
export async function joinSlot(db: Db, input: JoinSlotInput): Promise<JoinSlotResult> {
  const assignmentId = newId();
  try {
    const result = await db.run(sql`
      insert into assignment (id, slot_id, participant_id, created_at)
      select ${assignmentId}, ${input.slotId}, ${input.participantId}, ${input.now}
      where not exists (
        select 1 from assignment where slot_id = ${input.slotId}
      )
    `);
    if (result.meta.changes === 0) {
      return { kind: "taken" };
    }
    return { kind: "joined", assignmentId };
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return { kind: "taken" };
    }
    throw err;
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && /unique/i.test(err.message);
}

/** 指定した枠のエントリーを削除する(辞退)。 */
export async function leaveSlot(db: Db, slotId: string): Promise<void> {
  await db.delete(assignment).where(eq(assignment.slotId, slotId));
}

/** 枠そのものを削除する。CASCADE により Assignment も削除される。 */
export async function deleteSlot(db: Db, slotId: string): Promise<void> {
  await db.delete(slot).where(eq(slot.id, slotId));
}

export interface SlotContext {
  slot: {
    id: string;
    takeId: string;
    instrument: string;
    note: string | null;
    sortOrder: number;
  };
  take: {
    id: string;
    songId: string;
    sortOrder: number;
    label: string | null;
  };
  song: {
    id: string;
    eventId: string;
    title: string;
  };
  assignment: {
    id: string;
    participantId: string;
    participantName: string;
  } | null;
}

/**
 * 枠を、その Take・曲・イベント・既存エントリー(担当者名つき)まで含めて取得する。
 * 呼び出し側は `song.eventId` を今リクエストしているイベントの id と必ず照合し、
 * 他イベントの slot id を弾くこと。
 */
export async function findSlotWithContext(
  db: Db,
  slotId: string,
): Promise<SlotContext | null> {
  const rows = await db
    .select({
      slotId: slot.id,
      slotTakeId: slot.takeId,
      slotInstrument: slot.instrument,
      slotNote: slot.note,
      slotSortOrder: slot.sortOrder,
      takeId: take.id,
      takeSongId: take.songId,
      takeSortOrder: take.sortOrder,
      takeLabel: take.label,
      songId: song.id,
      songEventId: song.eventId,
      songTitle: song.title,
      assignmentId: assignment.id,
      assignmentParticipantId: assignment.participantId,
      assignmentParticipantName: participantTable.displayName,
    })
    .from(slot)
    .innerJoin(take, eq(slot.takeId, take.id))
    .innerJoin(song, eq(take.songId, song.id))
    .leftJoin(assignment, eq(assignment.slotId, slot.id))
    .leftJoin(participantTable, eq(assignment.participantId, participantTable.id))
    .where(eq(slot.id, slotId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    slot: {
      id: row.slotId,
      takeId: row.slotTakeId,
      instrument: row.slotInstrument,
      note: row.slotNote,
      sortOrder: row.slotSortOrder,
    },
    take: {
      id: row.takeId,
      songId: row.takeSongId,
      sortOrder: row.takeSortOrder,
      label: row.takeLabel,
    },
    song: {
      id: row.songId,
      eventId: row.songEventId,
      title: row.songTitle,
    },
    assignment:
      row.assignmentId && row.assignmentParticipantId && row.assignmentParticipantName
        ? {
            id: row.assignmentId,
            participantId: row.assignmentParticipantId,
            participantName: row.assignmentParticipantName,
          }
        : null,
  };
}

export interface ExistingTakeAssignment {
  slotId: string;
  instrument: string;
}

/**
 * 同じ Take 内に、指定した参加者の別の Assignment が既にあるかを調べる。
 * 「同じ Take で複数の Slot に入る」警告の判定に使う。
 */
export async function findParticipantAssignmentInTake(
  db: Db,
  takeId: string,
  participantId: string,
): Promise<ExistingTakeAssignment | null> {
  const rows = await db
    .select({ slotId: slot.id, instrument: slot.instrument })
    .from(assignment)
    .innerJoin(slot, eq(assignment.slotId, slot.id))
    .where(and(eq(slot.takeId, takeId), eq(assignment.participantId, participantId)))
    .limit(1);
  return rows[0] ?? null;
}
