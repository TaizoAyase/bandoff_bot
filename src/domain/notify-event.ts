/**
 * イベントの新規作成・情報編集の Discord 通知本文を組み立てる純粋関数。
 * env / DB / fetch には触れない(送信は src/notify/schedule.ts + discord.ts)。
 */

import {
  changedFlagLine,
  diffLine,
  escapeMarkdown,
  formatActor,
  truncate,
} from "./notify-text";
import { formatEventPeriod } from "./time";

export interface NewEventInput {
  title: string;
  organizerDisplayName: string;
  region: string;
  startsAt: number;
  durationMinutes: number | null;
  place: string;
}

/**
 * 新しいオフ会が作成されたときの本文。秘密 URL・合言葉は
 * 仕様(2.2/7章)・計画のユーザー決定事項により含めない
 * (この型にもフィールドとして持たせない)。
 */
export function buildNewEventContent(input: NewEventInput): string {
  const title = escapeMarkdown(input.title);
  const actor = formatActor(input.organizerDisplayName);
  const region = escapeMarkdown(input.region);
  const place = escapeMarkdown(input.place);
  const period = formatEventPeriod(input.startsAt, input.durationMinutes);
  return truncate(
    [
      `〔${title}〕${actor}新しいオフ会を作成しました`,
      `- 地域: ${region}`,
      `- 日時: ${period}`,
      `- 場所: ${place}`,
    ].join("\n"),
  );
}

/** 主催者画面の「募集状況」選択肢(募集中・締切)に合わせたラベル。 */
const EVENT_STATUS_LABELS: Record<string, string> = {
  upcoming: "募集中",
  closed: "締切",
};

function eventStatusLabel(status: string): string {
  return EVENT_STATUS_LABELS[status] ?? status;
}

export interface EventEditedFields {
  title: string;
  region: string;
  startsAt: number;
  durationMinutes: number | null;
  place: string;
  /** 備考。DB の `null` は呼び出し側で "" に正規化してから渡すこと。 */
  notes: string;
  status: string;
}

export interface EventEditedInput {
  before: EventEditedFields;
  after: EventEditedFields;
}

/**
 * イベント情報編集の本文。変わった項目だけを箇条書きにする。備考は
 * 値そのものを出さず「変更しました」だけにする(仕様2.2と同じ理由で、
 * ユーザー入力の中身をこのチャンネルに残さない方針を備考にも適用する、
 * 計画のユーザー決定事項)。日時は開始時刻・長さのどちらか一方だけが
 * 変わった場合も1行にまとめて出す。何も変わっていなければ `null`
 * (呼び出し側は送信しない)。
 */
export function buildEventEditedContent(input: EventEditedInput): string | null {
  const { before, after } = input;
  const lines: string[] = [];

  const titleLine = diffLine("イベント名", before.title, after.title);
  if (titleLine) lines.push(titleLine);

  const regionLine = diffLine("地域", before.region, after.region);
  if (regionLine) lines.push(regionLine);

  if (
    before.startsAt !== after.startsAt ||
    before.durationMinutes !== after.durationMinutes
  ) {
    const beforePeriod = formatEventPeriod(before.startsAt, before.durationMinutes);
    const afterPeriod = formatEventPeriod(after.startsAt, after.durationMinutes);
    lines.push(`- 日時: ${beforePeriod} → ${afterPeriod}`);
  }

  const placeLine = diffLine("場所", before.place, after.place);
  if (placeLine) lines.push(placeLine);

  if (before.status !== after.status) {
    lines.push(
      `- 募集状況: ${eventStatusLabel(before.status)} → ${eventStatusLabel(after.status)}`,
    );
  }

  const notesLine = changedFlagLine("備考", before.notes !== after.notes);
  if (notesLine) lines.push(notesLine);

  if (lines.length === 0) {
    return null;
  }

  const title = escapeMarkdown(after.title);
  return truncate([`〔${title}〕イベント情報が変更されました`, ...lines].join("\n"));
}
