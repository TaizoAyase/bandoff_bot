/**
 * Discord Bot API への `fetch` 送信だけを担う。ペイロードの組み立て
 * (通知するかどうかの判断・本文生成)は呼び出し側(entry-changed.ts)の
 * 責務で、ここではチャンネル ID と本文を渡されたとおりに送るだけにする。
 */

/** Bot 送信のタイムアウト。fire-and-forget なので短めでよい。 */
const BOT_REQUEST_TIMEOUT_MS = 5000;

/** チャンネル ID(snowflake)は10進数の数字列のみ。 */
const CHANNEL_ID_PATTERN = /^\d{1,20}$/;

/**
 * Bot として1チャンネルにテキストを1通 POST する。
 *
 * `channelId` は URL に直接埋め込むため、事前に snowflake の形式
 * (`/^\d{1,20}$/`)であることを検証する。設定ミスでこの値に別の文字列が
 * 入っていた場合に、意図しない Discord API エンドポイントを叩いてしまう
 * のを防ぐため。一致しなければ送信せず `console.warn` のみ残す
 * (値そのものはログに出さない)。
 *
 * `allowed_mentions: { parse: [] }` は必須。表示名・曲名はユーザーが自由に
 * 入力できるため、これが無いと `@everyone` 等のメンションが実際に発火し、
 * サーバー全体への一斉通知を撃たれてしまう。
 *
 * `flags: 4`(`SUPPRESS_EMBEDS`)も必須。場所・曲名などに URL が入ると
 * Discord がリンクプレビューを展開しようとし、Discord のプロキシがその
 * URL を取得しにいく(仕様2.2で OGP を出さないのと同じ理由の、通知本文側)。
 *
 * 通知の失敗でユーザーのエントリー操作を巻き込んで 500 にしてはいけないため、
 * 非 2xx・例外のどちらも投げずに `console.warn` へ握りつぶす。
 * `botToken`(Bot として投稿する資格情報)・`channelId`・`content`(参加者の
 * 表示名を含む)はログに出さない。`[observability] enabled = true` の間は
 * ここでの出力も Cloudflare 側の invocation log に残るため。
 */
export async function postChannelMessage(
  botToken: string,
  channelId: string,
  content: string,
): Promise<void> {
  if (!CHANNEL_ID_PATTERN.test(channelId)) {
    console.warn("discord notify failed", { reason: "invalid channel id" });
    return;
  }
  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bot ${botToken}`,
          "content-type": "application/json",
          "user-agent": "DiscordBot (bandoff, 0.1.0)",
        },
        body: JSON.stringify({
          content,
          allowed_mentions: { parse: [] },
          flags: 4,
        }),
        signal: AbortSignal.timeout(BOT_REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      console.warn("discord notify failed", { status: response.status });
    }
  } catch (err) {
    console.warn("discord notify failed", {
      error: err instanceof Error ? err.name : typeof err,
    });
  }
}
