import { asc, eq, inArray, sql } from "drizzle-orm";
import { newId } from "../../domain/ids";
import type { Db } from "../client";
import {
  assignment,
  participant as participantTable,
  slot,
  song,
  take,
} from "../schema";

export interface AssignmentNode {
  id: string;
  participantId: string;
  participantName: string;
}

export interface SlotNode {
  id: string;
  instrument: string;
  note: string | null;
  sortOrder: number;
  createdBy: string;
  assignment: AssignmentNode | null;
}

export interface TakeNode {
  id: string;
  label: string | null;
  sortOrder: number;
  createdBy: string;
  slots: SlotNode[];
}

export interface SongNode {
  id: string;
  title: string;
  artist: string | null;
  refUrl: string | null;
  songKey: string | null;
  notes: string | null;
  proposedBy: string;
  createdAt: number;
  takes: TakeNode[];
}

/**
 * イベント内の曲を、Take・Slot・Assignment(担当者名つき)まで組み立てた
 * 木構造として取得する。songs / takes / slots / assignments+participant の
 * 4クエリで取り、メモリ上で組み立てる(N+1 を避けるため)。
 * 曲は created_at 昇順、Take / Slot は sort_order 昇順。
 */
export async function loadEventTree(db: Db, eventId: string): Promise<SongNode[]> {
  const songs = await db
    .select()
    .from(song)
    .where(eq(song.eventId, eventId))
    .orderBy(asc(song.createdAt));
  if (songs.length === 0) {
    return [];
  }

  const songIds = songs.map((s) => s.id);
  const takes = await db
    .select()
    .from(take)
    .where(inArray(take.songId, songIds))
    .orderBy(asc(take.sortOrder));

  const takeIds = takes.map((t) => t.id);
  const slots =
    takeIds.length === 0
      ? []
      : await db
          .select()
          .from(slot)
          .where(inArray(slot.takeId, takeIds))
          .orderBy(asc(slot.sortOrder));

  const slotIds = slots.map((s) => s.id);
  const assignments =
    slotIds.length === 0
      ? []
      : await db
          .select({
            id: assignment.id,
            slotId: assignment.slotId,
            participantId: assignment.participantId,
            participantName: participantTable.displayName,
          })
          .from(assignment)
          .innerJoin(
            participantTable,
            eq(assignment.participantId, participantTable.id),
          )
          .where(inArray(assignment.slotId, slotIds));

  const assignmentBySlotId = new Map(assignments.map((a) => [a.slotId, a]));

  const slotsByTakeId = new Map<string, SlotNode[]>();
  for (const s of slots) {
    const found = assignmentBySlotId.get(s.id);
    const node: SlotNode = {
      id: s.id,
      instrument: s.instrument,
      note: s.note,
      sortOrder: s.sortOrder,
      createdBy: s.createdBy,
      assignment: found
        ? {
            id: found.id,
            participantId: found.participantId,
            participantName: found.participantName,
          }
        : null,
    };
    const list = slotsByTakeId.get(s.takeId);
    if (list) {
      list.push(node);
    } else {
      slotsByTakeId.set(s.takeId, [node]);
    }
  }

  const takesBySongId = new Map<string, TakeNode[]>();
  for (const t of takes) {
    const node: TakeNode = {
      id: t.id,
      label: t.label,
      sortOrder: t.sortOrder,
      createdBy: t.createdBy,
      slots: slotsByTakeId.get(t.id) ?? [],
    };
    const list = takesBySongId.get(t.songId);
    if (list) {
      list.push(node);
    } else {
      takesBySongId.set(t.songId, [node]);
    }
  }

  return songs.map((s) => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    refUrl: s.refUrl,
    songKey: s.songKey,
    notes: s.notes,
    proposedBy: s.proposedBy,
    createdAt: s.createdAt,
    takes: takesBySongId.get(s.id) ?? [],
  }));
}

export interface CreateSongInput {
  eventId: string;
  title: string;
  artist: string;
  refUrl: string;
  songKey: string;
  notes: string;
  proposedBy: string;
  /** Take1 の初期枠構成。楽器名を sort_order 順に並べたもの。 */
  instruments: readonly string[];
  now: number;
}

/**
 * 曲・Take1・初期枠を原子的に作成する。
 */
export async function createSong(
  db: Db,
  input: CreateSongInput,
): Promise<{ songId: string }> {
  const songId = newId();
  const takeId = newId();
  const slotValues = input.instruments.map((instrument, index) => ({
    id: newId(),
    takeId,
    instrument,
    note: null,
    sortOrder: index + 1,
    createdBy: input.proposedBy,
    createdAt: input.now,
  }));

  await db.batch([
    db.insert(song).values({
      id: songId,
      eventId: input.eventId,
      title: input.title,
      artist: input.artist === "" ? null : input.artist,
      refUrl: input.refUrl === "" ? null : input.refUrl,
      songKey: input.songKey === "" ? null : input.songKey,
      notes: input.notes === "" ? null : input.notes,
      proposedBy: input.proposedBy,
      createdAt: input.now,
    }),
    db.insert(take).values({
      id: takeId,
      songId,
      label: null,
      sortOrder: 1,
      createdBy: input.proposedBy,
      createdAt: input.now,
    }),
    db.insert(slot).values(slotValues),
  ]);

  return { songId };
}

/** イベント内の曲数を数える(上限チェック用)。 */
export async function countSongs(db: Db, eventId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(song)
    .where(eq(song.eventId, eventId));
  return rows[0]?.count ?? 0;
}
