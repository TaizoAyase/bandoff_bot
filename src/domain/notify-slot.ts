/**
 * 枠追加の Discord 通知本文を組み立てる純粋関数。
 * env / DB / fetch には触れない(送信は src/notify/schedule.ts + discord.ts)。
 */

import {
  escapeMarkdown,
  formatActor,
  formatTitleWithOrdinal,
  truncate,
} from "./notify-text";

export interface SlotAddedInput {
  eventTitle: string;
  actorDisplayName: string | null;
  songTitle: string;
  /** その曲の Take が2件以上のときだけ値を持つ(既存の表示規則と同じ)。 */
  takeOrdinal: number | null;
  /** `Gt1`/`Gt2` のように自動採番済みの枠ラベル。 */
  slotLabel: string;
  /** "" ならメモ行を出さない。 */
  note: string;
}

/**
 * 枠が追加されたときの本文。ラベル・回数は呼び出し側が
 * `findSlotLabelInfo` で採番済みの値を求めて渡す(同じ楽器が増えると
 * `Gt` → `Gt1`/`Gt2` に振り直されるため)。
 */
export function buildSlotAddedContent(input: SlotAddedInput): string {
  const eventTitle = escapeMarkdown(input.eventTitle);
  const actor = formatActor(input.actorDisplayName);
  const songLabel = formatTitleWithOrdinal(input.songTitle, input.takeOrdinal);
  const slotLabel = escapeMarkdown(input.slotLabel);
  const lines = [
    `〔${eventTitle}〕${actor}${songLabel}に ${slotLabel} の枠を追加しました`,
  ];
  if (input.note !== "") {
    lines.push(`- メモ: ${escapeMarkdown(input.note)}`);
  }
  return truncate(lines.join("\n"));
}
