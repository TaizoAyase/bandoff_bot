/**
 * 「Discordに貼る文面」(URLと合言葉をまとめたテキスト)を組み立てる。
 * イベント作成直後の welcome ページと、参加者登録直後の welcome ページの
 * 両方から使う。
 */
export function buildPasteText(
  origin: string,
  slug: string,
  title: string,
  joinCode: string,
): string {
  const url = `${origin}/e/${slug}/`;
  return `${title}\n${url}\n合言葉: ${joinCode}`;
}
