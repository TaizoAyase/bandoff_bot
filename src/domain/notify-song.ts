/**
 * 曲の追加・情報編集・Take 追加の Discord 通知本文を組み立てる純粋関数。
 * env / DB / fetch には触れない(送信は src/notify/schedule.ts + discord.ts)。
 */

import { numberInstruments } from "./instruments";
import {
  changedFlagLine,
  diffLine,
  escapeMarkdown,
  formatActor,
  truncate,
} from "./notify-text";

export interface SongAddedInput {
  eventTitle: string;
  actorDisplayName: string | null;
  title: string;
  /** "" なら「アーティスト」行を出さない。 */
  artist: string;
  /** Take1 の初期枠構成(採番前の生の楽器名。並び順は sort_order 順)。 */
  instruments: readonly string[];
}

/** 曲が追加されたときの本文。 */
export function buildSongAddedContent(input: SongAddedInput): string {
  const eventTitle = escapeMarkdown(input.eventTitle);
  const actor = formatActor(input.actorDisplayName);
  const title = escapeMarkdown(input.title);
  const lines = [`〔${eventTitle}〕${actor}「${title}」を追加しました`];
  if (input.artist !== "") {
    lines.push(`- アーティスト: ${escapeMarkdown(input.artist)}`);
  }
  // /me・参加者一覧と同じ採番済みラベル(Gt1・Gt2 等)で表記を揃える。
  const labels = numberInstruments(input.instruments).map(escapeMarkdown);
  lines.push(`- パート: ${labels.join("、")}`);
  return truncate(lines.join("\n"));
}

export interface SongEditedFields {
  title: string;
  artist: string;
  refUrl: string;
  songKey: string;
  notes: string;
}

export interface SongEditedInput {
  eventTitle: string;
  actorDisplayName: string | null;
  /**
   * DB の `null` と空文字は同一視する(計画のユーザー決定事項)。
   * 呼び出し側で正規化してから渡すこと。
   */
  before: SongEditedFields;
  after: SongEditedFields;
}

/**
 * 曲情報編集の本文。変わった項目だけを箇条書きにする。参考 URL・備考は
 * 値そのものを出さず「変更しました」だけにする。何も変わっていなければ
 * `null`(呼び出し側は送信しない)。
 */
export function buildSongEditedContent(input: SongEditedInput): string | null {
  const { before, after } = input;
  const lines: string[] = [];

  const titleLine = diffLine("曲名", before.title, after.title);
  if (titleLine) lines.push(titleLine);

  const artistLine = diffLine("アーティスト", before.artist, after.artist);
  if (artistLine) lines.push(artistLine);

  const keyLine = diffLine("キー", before.songKey, after.songKey);
  if (keyLine) lines.push(keyLine);

  const refUrlLine = changedFlagLine("参考URL", before.refUrl !== after.refUrl);
  if (refUrlLine) lines.push(refUrlLine);

  const notesLine = changedFlagLine("備考", before.notes !== after.notes);
  if (notesLine) lines.push(notesLine);

  if (lines.length === 0) {
    return null;
  }

  const eventTitle = escapeMarkdown(input.eventTitle);
  const actor = formatActor(input.actorDisplayName);
  const title = escapeMarkdown(before.title);
  return truncate(
    [`〔${eventTitle}〕${actor}「${title}」の曲情報を変更しました`, ...lines].join(
      "\n",
    ),
  );
}

export interface TakeAddedInput {
  eventTitle: string;
  actorDisplayName: string | null;
  songTitle: string;
  /**
   * 追加後の Take の順位(1始まり)。追加前の件数+1 は同時操作でずれる
   * ため使わず、DB から実際の並びを見て求めた値を渡すこと。
   */
  takeOrdinal: number;
}

/** 2回目以降の Take が追加されたときの本文。 */
export function buildTakeAddedContent(input: TakeAddedInput): string {
  const eventTitle = escapeMarkdown(input.eventTitle);
  const actor = formatActor(input.actorDisplayName);
  const songTitle = escapeMarkdown(input.songTitle);
  return truncate(
    `〔${eventTitle}〕${actor}「${songTitle}」の${input.takeOrdinal}回目を追加しました`,
  );
}
