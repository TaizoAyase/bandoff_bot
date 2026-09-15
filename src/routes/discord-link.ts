import { Hono } from "hono";
import { consumeDiscordLink } from "../db/queries/discord-links";
import { findByDiscordUserId, linkDiscordUser } from "../db/queries/participants";
import { sha256Hex } from "../domain/crypto";
import { isPast24h } from "../domain/time";
import type { AppEnv } from "../env";
import { requireParticipant, requireViewer } from "../middleware/guards";
import { setSession } from "../middleware/session";
import { DiscordOpenPage } from "../views/pages/discord-open";
import { notFoundResponse } from "../views/pages/error";
import { renderPage } from "../views/render";
import { extractToken } from "./form";

/**
 * Discord の `/bandoff open` から届いたリンクの着地(`/e/:slug/discord`、
 * 計画5章)。トークンは URL のフラグメントに乗せてサーバーに渡さないため、
 * ここではまず素の着地ページだけを返し、消費はクライアント JS からの
 * `POST`(フラグメントを読める側)に任せる。
 */
export const discordLinkApp = new Hono<AppEnv>({ strict: false });

// cookie が無くても表示する(ガードを付けない。計画5-2)。
discordLinkApp.get("/discord", async (c) => {
  const event = c.get("event");
  if (!event) {
    return notFoundResponse(c);
  }
  return renderPage(c, DiscordOpenPage({ slug: event.slug }));
});

discordLinkApp.post("/discord", async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event) {
    return notFoundResponse(c);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text("Bad Request", 400);
  }
  const token = extractToken(body);
  if (!token) {
    return c.text("Bad Request", 400);
  }

  const db = c.get("db");
  const now = Math.floor(Date.now() / 1000);
  const tokenHash = await sha256Hex(token);
  const consumed = await consumeDiscordLink(db, tokenHash, now);
  // トークンが不正・存在しない・期限切れ・使用済みのいずれも区別せず 401。
  // 消費した行が別イベントのものだった場合も同様に区別しない。
  if (!consumed || consumed.eventId !== event.id) {
    return c.text("Unauthorized", 401);
  }
  // 消費した後で(発行後に)Discord から開けなくなっていた場合も 401
  // (計画5-3: どちらも区別しない)。
  if (!event.discordEnabled || isPast24h(event.startsAt, now)) {
    return c.text("Unauthorized", 401);
  }

  // Discord 経由では主催者権限を決して付けない。今の cookie の値をそのまま
  // 保つ(計画5-3)。
  const isOrganizer = viewer?.isOrganizer ?? false;
  const pendingDiscord = {
    userId: consumed.discordUserId,
    nameHint: consumed.displayNameHint,
  };

  // A: このイベントに、その Discord ID が紐付いた参加中の participant がいる。
  const linked = await findByDiscordUserId(db, event.id, consumed.discordUserId);
  if (linked) {
    await setSession(c, event.slug, {
      e: event.id,
      p: linked.id,
      o: isOrganizer,
      pendingDiscord: null,
    });
    return c.json({ redirect: `/e/${event.slug}/` });
  }

  // B: A でなく、今の cookie の participant が未紐付け。
  if (viewer?.participant && viewer.participant.discordUserId === null) {
    await setSession(c, event.slug, {
      e: event.id,
      p: viewer.participant.id,
      o: isOrganizer,
      pendingDiscord,
    });
    return c.json({ redirect: `/e/${event.slug}/` });
  }

  // C: それ以外(未ログイン、または今の participant が別の Discord ID に
  // 紐付き済み)。
  await setSession(c, event.slug, {
    e: event.id,
    p: null,
    o: isOrganizer,
    pendingDiscord,
  });
  return c.json({ redirect: `/e/${event.slug}/` });
});

/**
 * 曲一覧の確認バナー(計画5-5、状況 B)からの同意。本人確認の設定操作の
 * ため `requireOpenForParticipants` は付けない(closed でも使える)。
 */
discordLinkApp.post("/discord/link", requireViewer, requireParticipant, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer?.participant) {
    return notFoundResponse(c);
  }

  if (!viewer.pendingDiscord) {
    return c.redirect(`/e/${event.slug}/`, 303);
  }

  const db = c.get("db");
  const linked = await linkDiscordUser(db, {
    eventId: event.id,
    participantId: viewer.participant.id,
    discordUserId: viewer.pendingDiscord.userId,
  });
  await setSession(c, event.slug, {
    e: event.id,
    p: viewer.participant.id,
    o: viewer.isOrganizer,
    pendingDiscord: null,
  });
  const notice = linked ? "discord-linked" : "discord-link-conflict";
  return c.redirect(`/e/${event.slug}/?notice=${notice}`, 303);
});

/**
 * 曲一覧の確認・案内バナー(計画5-5)を消すだけの操作。本人確認の設定操作の
 * ため `requireOpenForParticipants` は付けない(closed でも使える)。
 */
discordLinkApp.post("/discord/dismiss", requireViewer, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return notFoundResponse(c);
  }
  await setSession(c, event.slug, {
    e: event.id,
    p: viewer.participant?.id ?? null,
    o: viewer.isOrganizer,
    pendingDiscord: null,
  });
  return c.redirect(`/e/${event.slug}/`, 303);
});
