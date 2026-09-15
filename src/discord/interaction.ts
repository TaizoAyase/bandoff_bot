/**
 * Discord Interactions の JSON(`unknown`)から、必要なフィールドだけを
 * 型ガードで取り出す純関数(計画4-3)。単体テストしやすくするため、
 * ルート本体(`src/routes/discord-interactions.ts`)とは分ける。
 */

import { isValidDiscordSnowflake } from "../domain/discord";

/** Interaction の種類(Discord API の定数)。 */
export const INTERACTION_TYPE = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
} as const;

/** 応答の種類(Discord API の定数)。 */
export const RESPONSE_TYPE = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  AUTOCOMPLETE_RESULT: 8,
} as const;

/** EPHEMERAL(64) | SUPPRESS_EMBEDS(4)。すべてのメッセージ応答に付ける。 */
export const MESSAGE_FLAGS_EPHEMERAL_SUPPRESS_EMBEDS = 64 | 4;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** `type` フィールドを読む。無い・数値でなければ `null`。 */
export function readInteractionType(body: unknown): number | null {
  const type = asRecord(body)?.type;
  return typeof type === "number" ? type : null;
}

/** `guild_id` を読む(DM には無い)。無い・文字列でなければ `null`。 */
export function readGuildId(body: unknown): string | null {
  const guildId = asRecord(body)?.guild_id;
  return typeof guildId === "string" ? guildId : null;
}

export interface DiscordMember {
  /** 実行者の Discord ユーザー ID(snowflake 形式を確認済み)。 */
  discordUserId: string;
  /** サーバーのニックネーム。未設定なら `null`。 */
  nick: string | null;
  /** グローバル表示名。未設定なら `null`。 */
  globalName: string | null;
  /** ユーザー名。 */
  username: string | null;
}

/**
 * `member.user.id` を中心に実行者情報を取り出す。サーバー内での実行
 * (ギルドコマンド)なので `member` がある前提(計画4-3)。`id` が
 * snowflake 形式でなければ `null` を返す。
 */
export function readMember(body: unknown): DiscordMember | null {
  const member = asRecord(asRecord(body)?.member);
  const user = asRecord(member?.user);
  const id = user?.id;
  if (typeof id !== "string" || !isValidDiscordSnowflake(id)) {
    return null;
  }
  const nick = member?.nick;
  const globalName = user?.global_name;
  const username = user?.username;
  return {
    discordUserId: id,
    nick: typeof nick === "string" ? nick : null,
    globalName: typeof globalName === "string" ? globalName : null,
    username: typeof username === "string" ? username : null,
  };
}

function readData(body: unknown): Record<string, unknown> | null {
  return asRecord(asRecord(body)?.data);
}

/** コマンド名(トップレベル、例 `"bandoff"`)を読む。 */
export function readCommandName(body: unknown): string | null {
  const name = readData(body)?.name;
  return typeof name === "string" ? name : null;
}

function readOptionRecords(
  parent: Record<string, unknown> | null,
): Record<string, unknown>[] {
  const options = parent?.options;
  if (!Array.isArray(options)) {
    return [];
  }
  return options
    .map((option) => asRecord(option))
    .filter((option): option is Record<string, unknown> => option !== null);
}

export interface SubcommandInfo {
  /** サブコマンド名(例 `"open"` `"list"` `"new"`)。 */
  name: string;
  /** サブコマンドのオプション一覧(生のレコードのまま)。 */
  options: Record<string, unknown>[];
}

/**
 * `data.options[0]` をサブコマンドとして読む(このアプリのコマンドは
 * すべて `bandoff <サブコマンド>` の形のため)。サブコマンドが無い・
 * 名前が文字列でなければ `null`。
 */
export function readSubcommand(body: unknown): SubcommandInfo | null {
  const options = readOptionRecords(readData(body));
  const sub = options[0];
  const name = sub?.name;
  if (typeof name !== "string") {
    return null;
  }
  return { name, options: readOptionRecords(sub ?? null) };
}

/** サブコマンドのオプションから、指定した名前の文字列値を読む。 */
export function readStringOptionValue(
  options: Record<string, unknown>[],
  optionName: string,
): string | null {
  const value = options.find((option) => option.name === optionName)?.value;
  return typeof value === "string" ? value : null;
}

/**
 * オートコンプリート中(`focused: true`)のオプションの入力途中の文字列を読む。
 * 対象のオプションが無い・focused でない・値が文字列でなければ `null`。
 */
export function readFocusedOptionValue(
  options: Record<string, unknown>[],
  optionName: string,
): string | null {
  const found = options.find(
    (option) => option.name === optionName && option.focused === true,
  );
  const value = found?.value;
  return typeof value === "string" ? value : null;
}

/** ボタン押下(`MESSAGE_COMPONENT`)の `custom_id` を読む。 */
export function readCustomId(body: unknown): string | null {
  const customId = readData(body)?.custom_id;
  return typeof customId === "string" ? customId : null;
}
