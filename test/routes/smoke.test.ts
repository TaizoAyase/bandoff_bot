import { env } from "cloudflare:test";
import { Hono } from "hono";
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
    place: "テスト会場",
    notes: null,
    status: "upcoming",
    joinCode: "himitsu",
    organizerKeyHash: "x",
    organizerParticipantId: null,
    createdAt: 0,
    updatedAt: 0,
  };

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
      });
      return c.body(null);
    });
    testApp.use("/read", sessionMiddleware);
    testApp.get("/read", (c) => {
      const viewer = c.get("viewer");
      return c.json({
        hasViewer: viewer !== undefined,
        participantId: viewer?.participant?.id ?? null,
        isOrganizer: viewer?.isOrganizer ?? null,
      });
    });
    return testApp;
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
    });
  });
});
