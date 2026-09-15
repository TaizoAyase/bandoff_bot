/**
 * 参加者登録(+ 同時のエントリー)の Discord 通知本文を組み立てる純粋関数。
 * env / DB / fetch には触れない(送信は src/notify/schedule.ts + discord.ts)。
 */

import {
  escapeMarkdown,
  formatActor,
  formatTitleWithOrdinal,
  truncate,
} from "./notify-text";

export interface ParticipantRegisteredEntry {
  songTitle: string;
  takeOrdinal: number | null;
  slotLabel: string;
}

export interface ParticipantRegisteredInput {
  eventTitle: string;
  displayName: string;
  /** 同じリクエストで枠へのエントリーにも成功したときだけ渡す。 */
  entry: ParticipantRegisteredEntry | null;
}

/**
 * 参加者登録の本文。同じリクエストで枠へのエントリーにも成功した場合は
 * (旧・枠が見つからない・先を越された、いずれの場合も含めて)1通に
 * まとめる(既存の join 通知をこのルートに限り置き換える。計画の
 * ユーザー決定事項)。
 */
export function buildParticipantRegisteredContent(
  input: ParticipantRegisteredInput,
): string {
  const eventTitle = escapeMarkdown(input.eventTitle);
  const actor = formatActor(input.displayName);
  if (input.entry === null) {
    return truncate(`〔${eventTitle}〕${actor}参加登録しました`);
  }
  const songLabel = formatTitleWithOrdinal(
    input.entry.songTitle,
    input.entry.takeOrdinal,
  );
  const slotLabel = escapeMarkdown(input.entry.slotLabel);
  return truncate(
    `〔${eventTitle}〕${actor}参加登録し、${songLabel}の ${slotLabel} に入りました`,
  );
}
