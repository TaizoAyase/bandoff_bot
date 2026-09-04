/**
 * 日本時間(UTC+9、夏時間なし)固定のための日時ユーティリティ。
 * DB には UTC エポック秒で保存する。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ONE_DAY_SECONDS = 24 * 60 * 60;
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

const DATETIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * `<input type="datetime-local">` の値(JST 前提、例: `2026-09-05T19:00`)を
 * UTC エポック秒に変換する。
 */
export function parseJstDateTimeLocal(value: string): number {
  const match = DATETIME_LOCAL_PATTERN.exec(value);
  if (!match) {
    throw new Error("invalid datetime-local value");
  }
  const [, year, month, day, hour, minute] = match;
  const jstAsUtcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  return Math.floor((jstAsUtcMs - JST_OFFSET_MS) / 1000);
}

/** UTC エポック秒を `2026/09/05(土) 19:00` 形式(JST)で表示する。 */
export function formatJst(epochSeconds: number): string {
  const d = toJstWallClockDate(epochSeconds);
  const year = d.getUTCFullYear();
  const month = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  const weekday = WEEKDAY_JA[d.getUTCDay()];
  const hour = pad2(d.getUTCHours());
  const minute = pad2(d.getUTCMinutes());
  return `${year}/${month}/${day}(${weekday}) ${hour}:${minute}`;
}

/** UTC エポック秒を `<input type="datetime-local">` 用の値(JST)に変換する。 */
export function toJstDateTimeLocal(epochSeconds: number): string {
  const d = toJstWallClockDate(epochSeconds);
  const year = d.getUTCFullYear();
  const month = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  const hour = pad2(d.getUTCHours());
  const minute = pad2(d.getUTCMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * 開催日時から24時間経過したかを判定する。ちょうど86400秒(24時間)は
 * まだ経過していない扱いとする。
 */
export function isPast24h(startsAt: number, now: number): boolean {
  return now - startsAt > ONE_DAY_SECONDS;
}

/**
 * ホストのタイムゾーンに依存せず JST の壁時計値を取り出すため、
 * JST オフセットを加算した上で UTC の getter で読む。
 */
function toJstWallClockDate(epochSeconds: number): Date {
  return new Date(epochSeconds * 1000 + JST_OFFSET_MS);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
