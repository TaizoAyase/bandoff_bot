import { asc, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { newId } from "../../domain/ids";
import { numberInstruments } from "../../domain/instruments";
import type { Db } from "../client";
import {
  assignment,
  participant as participantTable,
  slot,
  song,
  songScoreUrl,
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
  scoreUrls: string[];
}

/**
 * イベント内の曲を、Take・Slot・Assignment(担当者名つき)まで組み立てた
 * 木構造として取得する。songs / takes+譜面URL / slots / assignments+participant の
 * 5クエリ(takes と譜面URLは1回の batch)で取り、メモリ上で組み立てる
 * (N+1 を避けるため)。曲は created_at 昇順、Take / Slot / 譜面URL は
 * sort_order 昇順。
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
  // takes と譜面URLはどちらも songIds にしか依存しないため、1回の batch に
  // まとめて D1 への往復を増やさない(曲一覧はポーリングで繰り返し叩かれる)。
  const [takes, scoreUrlRows] = await db.batch([
    db
      .select()
      .from(take)
      .where(inArray(take.songId, songIds))
      .orderBy(asc(take.sortOrder)),
    db
      .select({ songId: songScoreUrl.songId, url: songScoreUrl.url })
      .from(songScoreUrl)
      .where(inArray(songScoreUrl.songId, songIds))
      .orderBy(asc(songScoreUrl.sortOrder)),
  ]);

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

  const scoreUrlsBySongId = new Map<string, string[]>();
  for (const row of scoreUrlRows) {
    const list = scoreUrlsBySongId.get(row.songId);
    if (list) {
      list.push(row.url);
    } else {
      scoreUrlsBySongId.set(row.songId, [row.url]);
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
    scoreUrls: scoreUrlsBySongId.get(s.id) ?? [],
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
  /** 譜面URL。ラベルは持たず、並び順(sort_order)だけを持つ。 */
  scoreUrls: readonly string[];
  now: number;
}

/**
 * 曲・Take1・初期枠・譜面URLを原子的に作成する。
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
  const scoreUrlValues = input.scoreUrls.map((url, index) => ({
    id: newId(),
    songId,
    url,
    sortOrder: index + 1,
    createdAt: input.now,
  }));

  // db.batch は非空タプルを要求し、insert().values([]) は空配列で例外を
  // 投げるため、譜面URLが0件のときは文そのものを積まない。
  const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
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
  ];
  if (scoreUrlValues.length > 0) {
    statements.push(db.insert(songScoreUrl).values(scoreUrlValues));
  }
  await db.batch(statements);

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

export interface SongContext {
  id: string;
  eventId: string;
  title: string;
  artist: string | null;
  refUrl: string | null;
  songKey: string | null;
  notes: string | null;
  proposedBy: string;
  /** この曲のどの Slot にも誰もエントリーしていないか。 */
  hasAnyAssignment: boolean;
  /** 譜面URL。sort_order 昇順。 */
  scoreUrls: string[];
}

/**
 * 曲を、編集・削除の権限判定に必要な事実(誰もエントリーしていないか)・
 * 譜面URLまで含めて取得する。曲が存在しなければ null。
 */
export async function findSongContext(
  db: Db,
  songId: string,
): Promise<SongContext | null> {
  const rows = await db.select().from(song).where(eq(song.id, songId)).limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }

  const [assignmentRows, scoreUrlRows] = await db.batch([
    db
      .select({ id: assignment.id })
      .from(assignment)
      .innerJoin(slot, eq(assignment.slotId, slot.id))
      .innerJoin(take, eq(slot.takeId, take.id))
      .where(eq(take.songId, songId))
      .limit(1),
    db
      .select({ url: songScoreUrl.url })
      .from(songScoreUrl)
      .where(eq(songScoreUrl.songId, songId))
      .orderBy(asc(songScoreUrl.sortOrder)),
  ]);

  return {
    id: row.id,
    eventId: row.eventId,
    title: row.title,
    artist: row.artist,
    refUrl: row.refUrl,
    songKey: row.songKey,
    notes: row.notes,
    proposedBy: row.proposedBy,
    hasAnyAssignment: assignmentRows.length > 0,
    scoreUrls: scoreUrlRows.map((r) => r.url),
  };
}

export interface UpdateSongInput {
  title: string;
  artist: string;
  refUrl: string;
  songKey: string;
  notes: string;
  /** 譜面URL。全削除→再挿入するため、編集後の全件をこの順で渡す。 */
  scoreUrls: readonly string[];
  now: number;
}

/**
 * 曲情報(タイトル・アーティスト・参考URL・キー・備考・譜面URL)を編集する。
 * 枠構成は対象外。
 *
 * 譜面URLは差分更新ではなく全削除→再挿入する。理由:
 * - 譜面URLには識別子になるものが無い(ラベル無し・URL文字列だけ)。
 *   並べ替えは正当な編集操作なので、行の同一性を決める手段がない。
 * - 1曲あたり最大10行しかなく、全消し・全入れのコストは無視できる。
 * - db.batch は D1 の暗黙トランザクションなので、「0件の瞬間」が他の
 *   リクエストから見えることはない。
 *
 * 再挿入する行の created_at は編集時刻(input.now)で上書きされる。元の
 * 値を保つには「URL文字列でマッチさせて引き継ぐ」しかなく、重複や並べ替え
 * で破綻する上、この列は現状どこからも読まれていない(並びは sort_order、
 * 表示にも通知にも created_at は出ない)。
 */
export async function updateSong(
  db: Db,
  songId: string,
  input: UpdateSongInput,
): Promise<void> {
  const scoreUrlValues = input.scoreUrls.map((url, index) => ({
    id: newId(),
    songId,
    url,
    sortOrder: index + 1,
    createdAt: input.now,
  }));

  const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
    db
      .update(song)
      .set({
        title: input.title,
        artist: input.artist === "" ? null : input.artist,
        refUrl: input.refUrl === "" ? null : input.refUrl,
        songKey: input.songKey === "" ? null : input.songKey,
        notes: input.notes === "" ? null : input.notes,
      })
      .where(eq(song.id, songId)),
    db.delete(songScoreUrl).where(eq(songScoreUrl.songId, songId)),
  ];
  if (scoreUrlValues.length > 0) {
    statements.push(db.insert(songScoreUrl).values(scoreUrlValues));
  }
  await db.batch(statements);
}

/** 曲を削除する。CASCADE により Take・Slot・Assignment も削除される。 */
export async function deleteSong(db: Db, songId: string): Promise<void> {
  await db.delete(song).where(eq(song.id, songId));
}

/** 曲が持つ Take の総数を数える(上限チェック用)。 */
export async function countTakes(db: Db, songId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(take)
    .where(eq(take.songId, songId));
  return rows[0]?.count ?? 0;
}

export interface CreateTakeFromFirstInput {
  songId: string;
  createdBy: string;
  now: number;
}

/**
 * Take1(sort_order が最小の Take)の枠構成(instrument・note・sort_order)を
 * 空(担当者なし)で複製した新しい Take を追加する。曲が存在しない、または
 * 1件も Take を持たない(通常は起こらない)場合は null を返す。
 */
export async function createTakeFromFirst(
  db: Db,
  input: CreateTakeFromFirstInput,
): Promise<{ takeId: string } | null> {
  const existingTakes = await db
    .select()
    .from(take)
    .where(eq(take.songId, input.songId))
    .orderBy(asc(take.sortOrder));
  const first = existingTakes[0];
  if (!first) {
    return null;
  }
  const maxSortOrder = existingTakes.reduce((max, t) => Math.max(max, t.sortOrder), 0);

  const sourceSlots = await db
    .select()
    .from(slot)
    .where(eq(slot.takeId, first.id))
    .orderBy(asc(slot.sortOrder));

  const newTakeId = newId();
  const newTakeValues = {
    id: newTakeId,
    songId: input.songId,
    label: null,
    sortOrder: maxSortOrder + 1,
    createdBy: input.createdBy,
    createdAt: input.now,
  };

  if (sourceSlots.length === 0) {
    await db.insert(take).values(newTakeValues);
    return { takeId: newTakeId };
  }

  const slotValues = sourceSlots.map((s) => ({
    id: newId(),
    takeId: newTakeId,
    instrument: s.instrument,
    note: s.note,
    sortOrder: s.sortOrder,
    createdBy: input.createdBy,
    createdAt: input.now,
  }));

  await db.batch([
    db.insert(take).values(newTakeValues),
    db.insert(slot).values(slotValues),
  ]);
  return { takeId: newTakeId };
}

/** Take を削除する。CASCADE により Slot・Assignment も削除される。 */
export async function deleteTake(db: Db, takeId: string): Promise<void> {
  await db.delete(take).where(eq(take.id, takeId));
}

/**
 * 曲が持つ Take を `sort_order` 順に並べたときの、指定した Take の
 * 1始まりの順位を返す。Take が追加された直後に「n回目」を求めるための
 * もので、追加前の件数 + 1 は同時に複数人が Take を追加すると順位が
 * ずれるため使わず、DB から実際の並びを見て求める。Take が見つからなければ
 * `null`。
 */
export async function findTakeOrdinal(
  db: Db,
  songId: string,
  takeId: string,
): Promise<number | null> {
  const rows = await db
    .select({ id: take.id })
    .from(take)
    .where(eq(take.songId, songId))
    .orderBy(asc(take.sortOrder));
  const index = rows.findIndex((row) => row.id === takeId);
  return index === -1 ? null : index + 1;
}

export interface TakeContext {
  id: string;
  songId: string;
  song: { id: string; eventId: string; title: string };
  /** この曲が持つ Take の総数。 */
  takeCount: number;
  /** この Take 内の全 Slot が空か。 */
  allSlotsEmpty: boolean;
}

/**
 * Take を、その曲・イベント・削除可否の判定に必要な事実まで含めて取得する。
 * 呼び出し側は `song.eventId` を今リクエストしているイベントの id と
 * 必ず照合すること。
 */
export async function findTakeWithContext(
  db: Db,
  takeId: string,
): Promise<TakeContext | null> {
  const rows = await db
    .select({
      takeId: take.id,
      songId: take.songId,
      songEventId: song.eventId,
      songTitle: song.title,
    })
    .from(take)
    .innerJoin(song, eq(take.songId, song.id))
    .where(eq(take.id, takeId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }

  const [countRows, filledRows] = await db.batch([
    db
      .select({ count: sql<number>`count(*)` })
      .from(take)
      .where(eq(take.songId, row.songId)),
    db
      .select({ id: assignment.id })
      .from(assignment)
      .innerJoin(slot, eq(assignment.slotId, slot.id))
      .where(eq(slot.takeId, takeId))
      .limit(1),
  ]);

  return {
    id: row.takeId,
    songId: row.songId,
    song: { id: row.songId, eventId: row.songEventId, title: row.songTitle },
    takeCount: countRows[0]?.count ?? 0,
    allSlotsEmpty: filledRows.length === 0,
  };
}

/** Take が持つ Slot の総数を数える(上限チェック用)。 */
export async function countSlots(db: Db, takeId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(slot)
    .where(eq(slot.takeId, takeId));
  return rows[0]?.count ?? 0;
}

export interface CreateSlotInput {
  takeId: string;
  instrument: string;
  note: string;
  createdBy: string;
  now: number;
}

/** Take に新しい空の枠を追加する。`sort_order` は既存の最大値+1。 */
export async function createSlot(
  db: Db,
  input: CreateSlotInput,
): Promise<{ slotId: string }> {
  const maxRows = await db
    .select({ max: sql<number | null>`max(sort_order)` })
    .from(slot)
    .where(eq(slot.takeId, input.takeId));
  const nextSortOrder = (maxRows[0]?.max ?? 0) + 1;

  const slotId = newId();
  await db.insert(slot).values({
    id: slotId,
    takeId: input.takeId,
    instrument: input.instrument,
    note: input.note === "" ? null : input.note,
    sortOrder: nextSortOrder,
    createdBy: input.createdBy,
    createdAt: input.now,
  });
  return { slotId };
}

export interface MyAssignmentItem {
  songId: string;
  songTitle: string;
  /** その曲の Take が2件以上のときだけ値を持つ(「n回目」の表示可否)。 */
  takeOrdinal: number | null;
  /** `Gt1`/`Gt2` のように自動採番済みの枠ラベル。 */
  slotLabel: string;
  /** このエントリーが入っている Slot の id。 */
  slotId: string;
}

/**
 * 既に `loadEventTree` で取得した木構造から、指定した participant の
 * エントリーだけを「曲名 / n回目(あれば) / 枠ラベル」の形で抜き出す。
 * `/me`(自分のエントリー一覧)専用の純粋な変換で、DB へは触れない。
 */
export function deriveMyAssignments(
  songs: SongNode[],
  participantId: string,
): MyAssignmentItem[] {
  const items: MyAssignmentItem[] = [];
  for (const s of songs) {
    const showOrdinal = s.takes.length > 1;
    s.takes.forEach((t, takeIndex) => {
      const labels = numberInstruments(t.slots.map((slotNode) => slotNode.instrument));
      t.slots.forEach((slotNode, slotIndex) => {
        if (slotNode.assignment?.participantId === participantId) {
          items.push({
            songId: s.id,
            songTitle: s.title,
            takeOrdinal: showOrdinal ? takeIndex + 1 : null,
            slotLabel: labels[slotIndex] ?? slotNode.instrument,
            slotId: slotNode.id,
          });
        }
      });
    });
  }
  return items;
}
