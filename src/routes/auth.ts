import { Hono } from "hono";
import { countRecentFailures, recordFailure } from "../db/queries/auth-failures";
import {
  findByRecoveryKeyHash,
  findByTokenHash,
  updateParticipantTokenHash,
} from "../db/queries/participants";
import { sha256Hex, timingSafeEqual } from "../domain/crypto";
import { newToken, normalizeAccessKey } from "../domain/ids";
import { buildPasteText } from "../domain/paste-text";
import { isRateLimited, RATE_LIMIT_WINDOW_SECONDS } from "../domain/rate-limit";
import { normalizeJoinCode } from "../domain/validation";
import type { AppEnv } from "../env";
import { requireViewer } from "../middleware/guards";
import { setSession } from "../middleware/session";
import { notFoundResponse } from "../views/pages/error";
import { JoinPage } from "../views/pages/join";
import { RecoverPage } from "../views/pages/recover";
import { WelcomePage } from "../views/pages/welcome";
import { renderPage } from "../views/render";
import { formString } from "./form";

/**
 * 合言葉(join)、端末トークン再結合(rebind)、引き継ぎコードによる復旧(recover)を
 * 担当するルート。
 */
export const authApp = new Hono<AppEnv>({ strict: false });

export function clientIp(c: {
  req: { header(name: string): string | undefined };
}): string {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}

authApp.get("/join", async (c) => {
  const event = c.get("event");
  if (!event) {
    return c.text("Not Found", 404);
  }
  if (c.get("viewer")) {
    return c.redirect(`/e/${event.slug}/`, 303);
  }
  return renderPage(c, JoinPage({ slug: event.slug }));
});

authApp.post("/join", async (c) => {
  const event = c.get("event");
  if (!event) {
    return c.text("Not Found", 404);
  }

  const db = c.get("db");
  const ip = clientIp(c);
  const now = Math.floor(Date.now() / 1000);
  const since = now - RATE_LIMIT_WINDOW_SECONDS;

  const counts = await countRecentFailures(db, event.id, ip, since);
  if (isRateLimited(counts)) {
    return renderPage(
      c,
      JoinPage({
        slug: event.slug,
        error: "試行回数が多すぎます。しばらくしてから再試行してください",
      }),
      429,
    );
  }

  const body = await c.req.parseBody();
  const submitted = normalizeJoinCode(formString(body.joinCode));

  if (timingSafeEqual(submitted, event.joinCode)) {
    await setSession(c, event.slug, { e: event.id, p: null, o: false, iat: now });
    return c.redirect(`/e/${event.slug}/`, 303);
  }

  await recordFailure(db, event.id, ip, "join_code", now);
  return renderPage(c, JoinPage({ slug: event.slug, error: "合言葉が違います" }), 401);
});

authApp.post("/session/rebind", requireViewer, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return c.text("Not Found", 404);
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

  const tokenHash = await sha256Hex(token);
  const db = c.get("db");
  const participant = await findByTokenHash(db, tokenHash);
  if (!participant || participant.eventId !== event.id) {
    return c.text("Unauthorized", 401);
  }

  await setSession(c, event.slug, {
    e: event.id,
    p: participant.id,
    o: viewer.isOrganizer,
  });
  return c.body(null, 204);
});

authApp.get("/recover", requireViewer, async (c) => {
  const event = c.get("event");
  if (!event) {
    return notFoundResponse(c);
  }
  return renderPage(c, RecoverPage({ slug: event.slug }));
});

authApp.post("/recover", requireViewer, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return notFoundResponse(c);
  }

  const db = c.get("db");
  const ip = clientIp(c);
  const now = Math.floor(Date.now() / 1000);
  const since = now - RATE_LIMIT_WINDOW_SECONDS;

  const counts = await countRecentFailures(db, event.id, ip, since);
  if (isRateLimited(counts)) {
    return renderPage(
      c,
      RecoverPage({
        slug: event.slug,
        error: "試行回数が多すぎます。しばらくしてから再試行してください",
      }),
      429,
    );
  }

  const body = await c.req.parseBody();
  const rawInput = formString(body.recoveryKey);
  const normalized = normalizeAccessKey(rawInput);
  const hash = await sha256Hex(normalized);

  const found = await findByRecoveryKeyHash(db, event.id, hash);
  if (!found) {
    await recordFailure(db, event.id, ip, "recovery_key", now);
    return renderPage(
      c,
      RecoverPage({ slug: event.slug, error: "引き継ぎコードが正しくありません" }),
      401,
    );
  }

  // 引き継ぎコード復旧時は新しい端末トークンを発行し、旧トークンのハッシュを
  // 置き換える(計画「確定した決定事項」37行目)。
  const token = newToken();
  const tokenHash = await sha256Hex(token);
  await updateParticipantTokenHash(db, found.id, tokenHash);

  await setSession(c, event.slug, { e: event.id, p: found.id, o: viewer.isOrganizer });

  const origin = new URL(c.req.url).origin;
  const pasteText = buildPasteText(origin, event.slug, event.title, event.joinCode);

  return renderPage(
    c,
    WelcomePage({
      slug: event.slug,
      token,
      recoveryKey: rawInput.trim(),
      pasteText,
      entryResult: "この端末に引き継ぎました",
    }),
  );
});

function extractToken(body: unknown): string | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "token" in body &&
    typeof (body as { token: unknown }).token === "string"
  ) {
    const token = (body as { token: string }).token;
    return token === "" ? null : token;
  }
  return null;
}
