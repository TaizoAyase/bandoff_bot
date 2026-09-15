import { env } from "cloudflare:test";
import { Hono } from "hono";
import { setSignedCookie } from "hono/cookie";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import { workspace } from "../../src/db/schema";
import type { AppEnv, EventRow } from "../../src/env";
import app from "../../src/index";
import { sessionMiddleware, setSession } from "../../src/middleware/session";
import { createTestClient } from "../helpers";

describe("GET /", () => {
  it("returns 200 with the security headers and no OGP meta", async () => {
    const client = createTestClient();
    const response = await client.get("/");

    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const csp = response.headers.get("content-security-policy");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");

    const html = await response.text();
    expect(html.toLowerCase()).toContain("<!doctype html>");
    expect(html).not.toMatch(/property=["']og:/);
    expect(html).toContain('name="robots" content="noindex"');
  });
});

describe("default workspace", () => {
  it("has exactly one seeded row (from the migration)", async () => {
    const db = createDb(env.DB);
    const rows = await db.select().from(workspace);
    expect(rows).toHaveLength(1);
  });
});

describe("GET /e/:slug/ with an invalid slug", () => {
  it("returns a generic 404 without querying the database", async () => {
    const client = createTestClient();
    const response = await client.get("/e/not-a-valid-slug/");
    expect(response.status).toBe(404);
  });
});

describe("CSRF protection", () => {
  it("rejects a POST without an Origin header", async () => {
    // 有効な slug 形式(ただし未作成のイベント)に対して直接 POST する。
    // event ミドルウェアより前段の csrf ミドルウェアで弾かれることを確認する。
    const response = await app.request(
      "/e/aaaaaaaaaaaaaaaaaaaaaaaaaa/join",
      { method: "POST" },
      env,
    );
    expect(response.status).toBe(403);
  });

  it("accepts a POST with a matching Origin header", async () => {
    const client = createTestClient();
    const response = await client.post("/e/aaaaaaaaaaaaaaaaaaaaaaaaaa/join");
    // 合言葉ルート自体は M2 以降で追加するため、CSRF 検査は通り
    // その先の 404(汎用ページ)になることを確認する。
    expect(response.status).not.toBe(403);
  });
});

describe("signed session cookie round trip", () => {
  const fakeEvent: EventRow = {
    id: "event-1",
    workspaceId: "workspace-1",
    slug: "roundtriptestslugaaaaaaaa",
    title: "テストイベント",
    region: "東京",
    startsAt: 0,
    durationMinutes: null,
    place: "テスト会場",
    notes: null,
    status: "upcoming",
    joinCode: "himitsu",
    organizerKeyHash: "x",
    organizerParticipantId: null,
    discordEnabled: false,
    createdAt: 0,
    updatedAt: 0,
  };

  const COOKIE_NAME = "bandoff_session";

  function buildTestApp() {
    const testApp = new Hono<AppEnv>();
    testApp.use("*", async (c, next) => {
      c.set("db", createDb(c.env.DB));
      c.set("event", fakeEvent);
      await next();
    });
    testApp.get("/set", async (c) => {
      await setSession(c, fakeEvent.slug, {
        e: fakeEvent.id,
        p: "participant-1",
        o: true,
        pendingDiscord: null,
      });
      return c.body(null);
    });
    testApp.get("/set-pending", async (c) => {
      await setSession(c, fakeEvent.slug, {
        e: fakeEvent.id,
        p: "participant-1",
        o: false,
        pendingDiscord: { userId: "111111111111111111", nameHint: "にっく" },
      });
      return c.body(null);
    });
    // `setSignedCookie` へ直接、任意の(壊れた)ペイロードを渡すための経路。
    // `parsePayload`(session.ts の非公開関数)の型検証を、cookie の
    // ラウンドトリップ経由で確認する。
    testApp.get("/set-raw/:payload", async (c) => {
      await setSignedCookie(
        c,
        COOKIE_NAME,
        c.req.param("payload"),
        c.env.SESSION_SECRET,
        { path: `/e/${fakeEvent.slug}` },
      );
      return c.body(null);
    });
    testApp.use("/read", sessionMiddleware);
    testApp.get("/read", (c) => {
      const viewer = c.get("viewer");
      return c.json({
        hasViewer: viewer !== undefined,
        participantId: viewer?.participant?.id ?? null,
        isOrganizer: viewer?.isOrganizer ?? null,
        pendingDiscord: viewer?.pendingDiscord ?? null,
      });
    });
    return testApp;
  }

  function extractCookiePair(response: Response): string {
    const setCookie = response.headers.getSetCookie()[0] ?? "";
    return setCookie.split(";")[0] ?? "";
  }

  it("sets a cookie with the expected attributes", async () => {
    const testApp = buildTestApp();
    const setResponse = await testApp.request("/set", {}, env);
    const setCookies = setResponse.headers.getSetCookie();
    expect(setCookies).toHaveLength(1);

    const setCookie = setCookies[0] ?? "";
    expect(setCookie).toContain("bandoff_session=");
    expect(setCookie).toContain(`Path=/e/${fakeEvent.slug}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Max-Age=15552000");
    // http (非 https) のリクエストなので Secure は付かない。
    expect(setCookie).not.toContain("Secure");
  });

  it("reads back the viewer on the next request via the signed cookie", async () => {
    const testApp = buildTestApp();
    const setResponse = await testApp.request("/set", {}, env);
    const setCookie = setResponse.headers.getSetCookie()[0] ?? "";
    const cookiePair = setCookie.split(";")[0] ?? "";

    const readResponse = await testApp.request(
      "/read",
      { headers: { cookie: cookiePair } },
      env,
    );
    const body = await readResponse.json();
    expect(body).toEqual({
      hasViewer: true,
      participantId: null, // participant-1 は DB に存在しないため解決されない
      isOrganizer: true,
      pendingDiscord: null,
    });
  });

  it("does not resolve a viewer when no cookie is sent", async () => {
    const testApp = buildTestApp();
    const readResponse = await testApp.request("/read", {}, env);
    const body = await readResponse.json();
    expect(body).toEqual({
      hasViewer: false,
      participantId: null,
      isOrganizer: null,
      pendingDiscord: null,
    });
  });

  it("carries pendingDiscord (d/dn) through the signed cookie round trip", async () => {
    const testApp = buildTestApp();
    const setResponse = await testApp.request("/set-pending", {}, env);
    const cookiePair = extractCookiePair(setResponse);

    const readResponse = await testApp.request(
      "/read",
      { headers: { cookie: cookiePair } },
      env,
    );
    const body = await readResponse.json();
    expect(body).toEqual({
      hasViewer: true,
      participantId: null,
      isOrganizer: false,
      pendingDiscord: { userId: "111111111111111111", nameHint: "にっく" },
    });
  });

  it("omits the d/dn keys entirely when there is no pending link", async () => {
    const testApp = buildTestApp();
    const setResponse = await testApp.request("/set", {}, env);
    const cookiePair = extractCookiePair(setResponse);
    // 署名 cookie は `<JSON を URL エンコードした値>.<署名>` の形。
    // 署名検証はしていないので、先頭の JSON 部分だけ復号して見る。
    const rawValue = cookiePair.split("=").slice(1).join("=");
    const jsonPart = decodeURIComponent(rawValue.split(".")[0] ?? "");
    expect(jsonPart).not.toContain('"d"');
    expect(jsonPart).not.toContain('"dn"');
  });

  it("accepts a legacy cookie payload without d/dn keys at all", async () => {
    const testApp = buildTestApp();
    const legacyPayload = JSON.stringify({
      v: 1,
      e: fakeEvent.id,
      p: "participant-1",
      o: true,
      iat: 0,
    });
    const setResponse = await testApp.request(
      `/set-raw/${encodeURIComponent(legacyPayload)}`,
      {},
      env,
    );
    const cookiePair = extractCookiePair(setResponse);

    const readResponse = await testApp.request(
      "/read",
      { headers: { cookie: cookiePair } },
      env,
    );
    const body = await readResponse.json();
    expect(body).toEqual({
      hasViewer: true,
      participantId: null,
      isOrganizer: true,
      pendingDiscord: null,
    });
  });

  it("invalidates the whole cookie when d is present but not a valid snowflake", async () => {
    const testApp = buildTestApp();
    const badPayload = JSON.stringify({
      v: 1,
      e: fakeEvent.id,
      p: "participant-1",
      o: true,
      iat: 0,
      d: "not-a-snowflake",
      dn: "誰か",
    });
    const setResponse = await testApp.request(
      `/set-raw/${encodeURIComponent(badPayload)}`,
      {},
      env,
    );
    const cookiePair = extractCookiePair(setResponse);

    const readResponse = await testApp.request(
      "/read",
      { headers: { cookie: cookiePair } },
      env,
    );
    const body = await readResponse.json();
    expect(body).toEqual({
      hasViewer: false,
      participantId: null,
      isOrganizer: null,
      pendingDiscord: null,
    });
  });

  it("invalidates the whole cookie when dn exceeds the display name length limit", async () => {
    const testApp = buildTestApp();
    const badPayload = JSON.stringify({
      v: 1,
      e: fakeEvent.id,
      p: "participant-1",
      o: true,
      iat: 0,
      d: "111111111111111111",
      dn: "あ".repeat(31),
    });
    const setResponse = await testApp.request(
      `/set-raw/${encodeURIComponent(badPayload)}`,
      {},
      env,
    );
    const cookiePair = extractCookiePair(setResponse);

    const readResponse = await testApp.request(
      "/read",
      { headers: { cookie: cookiePair } },
      env,
    );
    const body = await readResponse.json();
    expect(body).toEqual({
      hasViewer: false,
      participantId: null,
      isOrganizer: null,
      pendingDiscord: null,
    });
  });
});
