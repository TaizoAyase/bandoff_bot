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

/**
 * UTC エポック秒を `9/5(土) 19:00` 形式(JST、年なし・月日は0埋めなし)で
 * 表示する。Discord のオートコンプリート候補の name は100文字までしか
 * 使えないため、`formatJst` より短い書式が要る(計画4-4)。
 */
export function formatJstShort(epochSeconds: number): string {
  const d = toJstWallClockDate(epochSeconds);
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const weekday = WEEKDAY_JA[d.getUTCDay()];
  const hour = pad2(d.getUTCHours());
  const minute = pad2(d.getUTCMinutes());
  return `${month}/${day}(${weekday}) ${hour}:${minute}`;
}

/** UTC エポック秒を `<input type="date">` 用の値(JST、`YYYY-MM-DD`)に変換する。 */
export function toJstDateString(epochSeconds: number): string {
  const d = toJstWallClockDate(epochSeconds);
  const year = d.getUTCFullYear();
  const month = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  return `${year}-${month}-${day}`;
}

/** UTC エポック秒を開始時刻 `<select>` 用の値(JST、`HH:MM`)に変換する。 */
export function toJstTimeString(epochSeconds: number): string {
  const d = toJstWallClockDate(epochSeconds);
  const hour = pad2(d.getUTCHours());
  const minute = pad2(d.getUTCMinutes());
  return `${hour}:${minute}`;
}

/**
 * 開催日時から24時間経過したかを判定する。ちょうど86400秒(24時間)は
 * まだ経過していない扱いとする。
 */
export function isPast24h(startsAt: number, now: number): boolean {
  return now - startsAt > ONE_DAY_SECONDS;
}

/** 長さ(分)を `"3時間"` `"1時間30分"` `"30分"` のように表示する。 */
export function formatDurationMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (hours === 0) {
    return `${remainderMinutes}分`;
  }
  if (remainderMinutes === 0) {
    return `${hours}時間`;
  }
  return `${hours}時間${remainderMinutes}分`;
}

/**
 * 開始日時と長さ(分)から期間の表示文字列を組み立てる。
 * `durationMinutes` が `null`(未設定)なら `formatJst` と同じ結果を返す。
 * 終了時刻が開始日をまたぐ場合は `翌 02:00` のように「翌」を付ける
 * (スタジオのオールナイトなど)。
 */
export function formatEventPeriod(
  startsAt: number,
  durationMinutes: number | null,
): string {
  if (durationMinutes === null) {
    return formatJst(startsAt);
  }
  const start = toJstWallClockDate(startsAt);
  const end = toJstWallClockDate(startsAt + durationMinutes * 60);
  const endTime = `${pad2(end.getUTCHours())}:${pad2(end.getUTCMinutes())}`;
  const crossesDay =
    end.getUTCFullYear() !== start.getUTCFullYear() ||
    end.getUTCMonth() !== start.getUTCMonth() ||
    end.getUTCDate() !== start.getUTCDate();
  const endLabel = crossesDay ? `翌 ${endTime}` : endTime;
  return `${formatJst(startsAt)}〜${endLabel} (${formatDurationMinutes(durationMinutes)})`;
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
