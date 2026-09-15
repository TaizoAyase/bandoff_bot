import type { Context } from "hono";
import { Hono } from "hono";
import type { Db } from "../db/client";
import { issueDiscordLink } from "../db/queries/discord-links";
import { findEventById, listDiscordCandidateEvents } from "../db/queries/events";
import { findJoinedEventIds } from "../db/queries/participants";
import type { DiscordMember } from "../discord/interaction";
import {
  INTERACTION_TYPE,
  MESSAGE_FLAGS_EPHEMERAL_SUPPRESS_EMBEDS,
  RESPONSE_TYPE,
  readCommandName,
  readCustomId,
  readFocusedOptionValue,
  readGuildId,
  readInteractionType,
  readMember,
  readStringOptionValue,
  readSubcommand,
} from "../discord/interaction";
import { isTimestampFresh, verifyDiscordSignature } from "../discord/verify";
import {
  buildCandidateName,
  buildDisplayNameHint,
  buildListActionRows,
  buildListBody,
  buildNewCommandMessage,
  buildOpenLinkMessage,
  type DiscordActionRow,
  parseOpenCustomId,
} from "../domain/discord-message";
import { isValidId } from "../domain/ids";
import { isPast24h } from "../domain/time";
import type { AppEnv } from "../env";

/**
 * 署名検証前に本文を読まないようにするための上限(バイト数)。
 * Discord のインタラクションの本文はこれよりずっと小さいはずなので、
 * これを超える場合は署名検証にすら進まず 401 として弾く(計画4-2)。
 */
const MAX_BODY_BYTES = 64 * 1024;

/** `/bandoff open` の候補が Discord にオートコンプリートとして返せる最大件数。 */
const AUTOCOMPLETE_CHOICE_LIMIT = 25;

/** イベントが Discord から開けない/存在しないときの共通文言(区別しない、計画4-4)。 */
const EVENT_NOT_OPENABLE_MESSAGE = "このイベントは Discord から開けません";

/**
 * Discord Interactions エンドポイント(計画4章)。`src/index.ts` から
 * `/discord` にマウントし、最終的なパスは `POST /discord/interactions` になる。
 * `/e/:slug` の外(cookie を使わない)に置き、CSRF 除外(`middleware/csrf.ts`)と
 * 対にする。
 */
export const discordInteractionsApp = new Hono<AppEnv>({ strict: false });

discordInteractionsApp.post("/interactions", async (c) => {
  const { DISCORD_PUBLIC_KEY, DISCORD_GUILD_ID } = c.env;
  if (!DISCORD_PUBLIC_KEY || !DISCORD_GUILD_ID) {
    return c.text("Not Found", 404);
  }

  const contentLengthHeader = c.req.header("content-length");
  if (contentLengthHeader !== undefined) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
      return rejectSignature(c, "size");
    }
  }

  const signature = c.req.header("x-signature-ed25519");
  const timestamp = c.req.header("x-signature-timestamp");
  if (!signature || !timestamp) {
    return rejectSignature(c, "headers");
  }

  const rawBody = await c.req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return rejectSignature(c, "size");
  }

  const now = Math.floor(Date.now() / 1000);
  if (!isTimestampFresh(timestamp, now)) {
    return rejectSignature(c, "timestamp");
  }

  const verified = await verifyDiscordSignature(
    DISCORD_PUBLIC_KEY,
    signature,
    timestamp,
    rawBody,
  );
  if (!verified) {
    return rejectSignature(c, "signature");
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return rejectSignature(c, "json");
  }

  const type = readInteractionType(body);
  if (type === INTERACTION_TYPE.PING) {
    return c.json({ type: RESPONSE_TYPE.PONG });
  }

  const db = c.get("db");

  if (type === INTERACTION_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE) {
    if (readGuildId(body) !== DISCORD_GUILD_ID) {
      return c.json(autocompleteResponse([]));
    }
    return c.json(await handleAutocomplete(db, body, now));
  }

  if (type === INTERACTION_TYPE.APPLICATION_COMMAND) {
    if (readGuildId(body) !== DISCORD_GUILD_ID) {
      return c.json(ephemeralMessage("このサーバーでは使えません"));
    }
    return handleCommand(c, db, body, now);
  }

  if (type === INTERACTION_TYPE.MESSAGE_COMPONENT) {
    if (readGuildId(body) !== DISCORD_GUILD_ID) {
      return c.json(ephemeralMessage("このサーバーでは使えません"));
    }
    return handleComponent(c, db, body, now);
  }

  return c.text("Bad Request", 400);
});

/**
 * 署名・タイムスタンプ・本文サイズ検証の失敗をすべて 401 として扱う。
 * `reason` は固定文字列のみ(ヘッダ・本文の値はログに出さない、計画4-2)。
 */
function rejectSignature(c: Context<AppEnv>, reason: string) {
  console.warn("discord interaction rejected", { reason });
  return c.text("invalid request signature", 401);
}

interface InteractionMessageResponse {
  type: 4;
  data: {
    content: string;
    components: DiscordActionRow[];
    flags: number;
    allowed_mentions: { parse: [] };
  };
}

/**
 * メッセージ応答(`type: 4`)を組み立てる。すべての応答に
 * `flags: 68`(EPHEMERAL | SUPPRESS_EMBEDS)と空の `allowed_mentions` を
 * 必ず付ける(計画4-3)。
 */
function toInteractionResponse(message: {
  content: string;
  components: DiscordActionRow[];
}): InteractionMessageResponse {
  return {
    type: RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: message.content,
      components: message.components,
      flags: MESSAGE_FLAGS_EPHEMERAL_SUPPRESS_EMBEDS,
      allowed_mentions: { parse: [] },
    },
  };
}

function ephemeralMessage(content: string): InteractionMessageResponse {
  return toInteractionResponse({ content, components: [] });
}

function autocompleteResponse(choices: { name: string; value: string }[]) {
  return { type: RESPONSE_TYPE.AUTOCOMPLETE_RESULT, data: { choices } };
}

async function handleAutocomplete(db: Db, body: unknown, now: number) {
  if (readCommandName(body) !== "bandoff") {
    return autocompleteResponse([]);
  }
  const subcommand = readSubcommand(body);
  if (subcommand?.name !== "open") {
    return autocompleteResponse([]);
  }
  const query = (
    readFocusedOptionValue(subcommand.options, "event") ?? ""
  ).toLowerCase();
  const candidates = await listDiscordCandidateEvents(db, now);
  const choices = candidates
    .filter((candidate) => candidate.title.toLowerCase().includes(query))
    .slice(0, AUTOCOMPLETE_CHOICE_LIMIT)
    .map((candidate) => ({
      name: buildCandidateName({
        id: candidate.id,
        title: candidate.title,
        region: candidate.region,
        startsAt: candidate.startsAt,
      }),
      value: candidate.id,
    }));
  return autocompleteResponse(choices);
}

async function handleCommand(c: Context<AppEnv>, db: Db, body: unknown, now: number) {
  if (readCommandName(body) !== "bandoff") {
    return c.text("Bad Request", 400);
  }
  const subcommand = readSubcommand(body);
  if (!subcommand) {
    return c.text("Bad Request", 400);
  }

  if (subcommand.name === "new") {
    const origin = new URL(c.req.url).origin;
    return c.json(toInteractionResponse(buildNewCommandMessage(`${origin}/new`)));
  }

  // open・list は実行者の Discord ID が要るため member が要る
  // (サーバー内の実行なので通常は必ず入っている。計画4-3)。
  const member = readMember(body);
  if (!member) {
    return c.text("Bad Request", 400);
  }

  if (subcommand.name === "open") {
    const eventId = readStringOptionValue(subcommand.options, "event") ?? "";
    return c.json(await buildOpenResponse(c, db, eventId, member, now));
  }

  if (subcommand.name === "list") {
    return c.json(await buildListResponse(db, member, now));
  }

  return c.text("Bad Request", 400);
}

async function handleComponent(c: Context<AppEnv>, db: Db, body: unknown, now: number) {
  const customId = readCustomId(body);
  const eventId = customId ? parseOpenCustomId(customId) : null;
  if (!eventId) {
    return c.text("Bad Request", 400);
  }
  const member = readMember(body);
  if (!member) {
    return c.text("Bad Request", 400);
  }
  return c.json(await buildOpenResponse(c, db, eventId, member, now));
}

/**
 * `/bandoff open` 実行・`/bandoff list` のボタン押下で共通のリンク発行処理
 * (計画4-4)。存在しない・`discord_enabled` でない・24時間を過ぎたイベントは
 * すべて同じ文言にする(区別しない)。
 */
async function buildOpenResponse(
  c: Context<AppEnv>,
  db: Db,
  eventId: string,
  member: DiscordMember,
  now: number,
): Promise<InteractionMessageResponse> {
  if (!isValidId(eventId)) {
    return ephemeralMessage(EVENT_NOT_OPENABLE_MESSAGE);
  }
  const event = await findEventById(db, eventId);
  if (!event?.discordEnabled || isPast24h(event.startsAt, now)) {
    return ephemeralMessage(EVENT_NOT_OPENABLE_MESSAGE);
  }

  const displayNameHint = buildDisplayNameHint({
    nick: member.nick,
    globalName: member.globalName,
    username: member.username,
  });
  const { token } = await issueDiscordLink(db, {
    eventId: event.id,
    discordUserId: member.discordUserId,
    displayNameHint,
    now,
  });
  const origin = new URL(c.req.url).origin;
  const url = `${origin}/e/${event.slug}/discord#${token}`;
  return toInteractionResponse(buildOpenLinkMessage({ eventTitle: event.title, url }));
}

async function buildListResponse(
  db: Db,
  member: DiscordMember,
  now: number,
): Promise<InteractionMessageResponse> {
  const candidates = await listDiscordCandidateEvents(db, now);
  const joinedEventIds = await findJoinedEventIds(
    db,
    candidates.map((candidate) => candidate.id),
    member.discordUserId,
  );
  const items = candidates.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    region: candidate.region,
    place: candidate.place,
    startsAt: candidate.startsAt,
    joined: joinedEventIds.has(candidate.id),
  }));
  return toInteractionResponse({
    content: buildListBody(items),
    components: buildListActionRows(items),
  });
}
