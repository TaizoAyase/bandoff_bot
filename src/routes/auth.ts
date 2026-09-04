import { Hono } from "hono";
import { countRecentFailures, recordFailure } from "../db/queries/auth-failures";
import { findByTokenHash } from "../db/queries/participants";
import { sha256Hex, timingSafeEqual } from "../domain/crypto";
import { isRateLimited, RATE_LIMIT_WINDOW_SECONDS } from "../domain/rate-limit";
import { normalizeJoinCode } from "../domain/validation";
import type { AppEnv } from "../env";
import { requireViewer } from "../middleware/guards";
import { setSession } from "../middleware/session";
import { JoinPage } from "../views/pages/join";
import { renderPage } from "../views/render";
import { formString } from "./form";

/** 合言葉(join)と端末トークン再結合(rebind)を担当するルート。 */
export const authApp = new Hono<AppEnv>({ strict: false });

function clientIp(c: { req: { header(name: string): string | undefined } }): string {
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
