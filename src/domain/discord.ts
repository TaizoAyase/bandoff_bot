/**
 * Discord 側の識別子(ユーザー ID・サーバー ID)に共通する形式検証。
 * Discord の「スノーフレーク ID」は符号なし64bit整数の10進表記
 * (最大20桁)で、DB に触れない純粋関数として切り出す(計画4-3)。
 * セッション cookie の保留中リンク(`d`)と、Interactions エンドポイントの
 * 両方から参照する。
 */
const DISCORD_SNOWFLAKE_PATTERN = /^\d{1,20}$/;

export function isValidDiscordSnowflake(value: string): boolean {
  return DISCORD_SNOWFLAKE_PATTERN.test(value);
}
