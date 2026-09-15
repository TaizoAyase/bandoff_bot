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

export interface ParticipantWithdrawnEntry {
  songTitle: string;
  takeOrdinal: number | null;
  slotLabel: string;
}

export interface ParticipantWithdrawnInput {
  eventTitle: string;
  displayName: string;
  /** 取りやめと同時に消えた全エントリー。無ければ空配列。 */
  entries: ParticipantWithdrawnEntry[];
}

/**
 * 参加の取りやめ(本人のみ。主催者による削除は通知しない、計画のユーザー
 * 決定事項)の本文(N9)。エントリーが残っていた場合は、主催者の一括辞退
 * (`notify-message.ts` の `formatMultiple`)と同じ箇条書き形式でまとめる。
 */
export function buildParticipantWithdrawnContent(
  input: ParticipantWithdrawnInput,
): string {
  const eventTitle = escapeMarkdown(input.eventTitle);
  const actor = formatActor(input.displayName);
  if (input.entries.length === 0) {
    return truncate(`〔${eventTitle}〕${actor}参加を取りやめました`);
  }
  const lines = input.entries.map(
    (entry) =>
      `- ${formatTitleWithOrdinal(entry.songTitle, entry.takeOrdinal)}の ${escapeMarkdown(entry.slotLabel)}`,
  );
  return truncate(
    [
      `〔${eventTitle}〕${actor}参加を取りやめ、以下のエントリーを辞退しました`,
      ...lines,
    ].join("\n"),
  );
}
