import { formatEventPeriod } from "./time";

/**
 * 「Discordに貼る文面」(タイトル・日時・場所・URLと合言葉をまとめたテキスト)を
 * 組み立てる。イベント作成直後の welcome ページ、参加者登録直後・引き継ぎコード
 * 復旧直後の welcome ページ、主催者画面の両方から使う。
 * 長さ(durationMinutes)が未設定なら日時の行は `formatJst` の結果のみになる。
 */
export function buildPasteText(
  origin: string,
  slug: string,
  title: string,
  startsAt: number,
  durationMinutes: number | null,
  place: string,
  joinCode: string,
): string {
  const url = `${origin}/e/${slug}/`;
  const schedule = formatEventPeriod(startsAt, durationMinutes);
  return `${title}\n${schedule}\n${place}\n${url}\n合言葉: ${joinCode}`;
}
