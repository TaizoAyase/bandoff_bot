import { lt, sql } from "drizzle-orm";
import { sha256Hex } from "../../domain/crypto";
import { newToken } from "../../domain/ids";
import type { Db } from "../client";
import { discordLink } from "../schema";

/** 発行から失効するまでの秒数(計画2章・3-2)。 */
const LINK_TTL_SECONDS = 600;

export interface IssueDiscordLinkInput {
  eventId: string;
  discordUserId: string;
  displayNameHint: string;
  now: number;
}

export interface IssuedDiscordLink {
  /** 平文トークン(URL のフラグメントに乗せる。DB にはハッシュのみ保存)。 */
  token: string;
}

/**
 * 1回限りのリンクを発行する(`/bandoff open` 実行・ボタン押下、計画4-4)。
 * 発行のたびに期限切れの行を掃除する(計画3-2: テーブルを小さく保つ。
 * 使用済みも期限切れになれば消える)。掃除と発行はどちらか片方だけ適用
 * されても実害が無い独立した操作のため `db.batch()` でまとめる必要はない。
 */
export async function issueDiscordLink(
  db: Db,
  input: IssueDiscordLinkInput,
): Promise<IssuedDiscordLink> {
  await db.delete(discordLink).where(lt(discordLink.expiresAt, input.now));

  const token = newToken();
  const tokenHash = await sha256Hex(token);
  await db.insert(discordLink).values({
    tokenHash,
    eventId: input.eventId,
    discordUserId: input.discordUserId,
    displayNameHint: input.displayNameHint,
    expiresAt: input.now + LINK_TTL_SECONDS,
    usedAt: null,
  });
  return { token };
}

export interface ConsumedDiscordLink {
  eventId: string;
  discordUserId: string;
  displayNameHint: string;
}

/**
 * 1回限りのリンクトークンを原子的に消費する(計画5-3)。`UPDATE ... WHERE
 * used_at IS NULL AND expires_at > now RETURNING ...` の1文で「未消費・
 * 未期限切れであることの確認」と「消費済みにする更新」を同時に行うことで、
 * 2重に POST されても片方だけが成功するようにする。該当行が無ければ
 * `null`(呼び出し側は 401 として扱う)。
 */
export async function consumeDiscordLink(
  db: Db,
  tokenHash: string,
  now: number,
): Promise<ConsumedDiscordLink | null> {
  const result = await db.run(sql`
    update discord_link
    set used_at = ${now}
    where token_hash = ${tokenHash}
      and used_at is null
      and expires_at > ${now}
    returning event_id, discord_user_id, display_name_hint
  `);
  const row = parseConsumedRow(result.results[0]);
  if (!row) {
    return null;
  }
  return {
    eventId: row.event_id,
    discordUserId: row.discord_user_id,
    displayNameHint: row.display_name_hint,
  };
}

interface ConsumedDiscordLinkRow {
  event_id: string;
  discord_user_id: string;
  display_name_hint: string;
}

function parseConsumedRow(row: unknown): ConsumedDiscordLinkRow | null {
  if (
    typeof row !== "object" ||
    row === null ||
    typeof (row as Record<string, unknown>).event_id !== "string" ||
    typeof (row as Record<string, unknown>).discord_user_id !== "string" ||
    typeof (row as Record<string, unknown>).display_name_hint !== "string"
  ) {
    return null;
  }
  return row as ConsumedDiscordLinkRow;
}
