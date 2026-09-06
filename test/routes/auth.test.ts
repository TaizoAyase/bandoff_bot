import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import { authFailure, event as eventTable } from "../../src/db/schema";
import { newId } from "../../src/domain/ids";
import app from "../../src/index";
import { createEvent, createTestClient, joinAsViewer } from "../helpers";

describe("GET /e/:slug/join", () => {
  it("does not reveal the event name or title", async () => {
    const created = await createEvent({ title: "秘密のオフ会タイトル" });
    const client = createTestClient();
    const response = await client.get(`/e/${created.slug}/join`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).not.toContain("秘密のオフ会タイトル");
    expect(html).not.toContain(created.joinCode);
    expect(html).toContain('data-toggle-visibility="joinCode"');
  });

  it("redirects an already-viewer to the song list", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await client.get(`/e/${created.slug}/join`, {
      redirect: "manual",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${created.slug}/`);
  });
});

describe("POST /e/:slug/join", () => {
  it("rejects a request without an Origin header", async () => {
    const created = await createEvent();
    const response = await app.request(
      `/e/${created.slug}/join`,
      { method: "POST", body: new URLSearchParams({ joinCode: created.joinCode }) },
      env,
    );
    expect(response.status).toBe(403);
  });

  it("returns 401 and re-renders the form on a wrong join code", async () => {
    const created = await createEvent();
    const client = createTestClient();
    const response = await client.post(`/e/${created.slug}/join`, {
      joinCode: "wrong-code",
    });
    expect(response.status).toBe(401);
  });

  it("succeeds with 303 and a Set-Cookie on the right join code", async () => {
    const created = await createEvent();
    const client = createTestClient();
    // ブラウザの <form method="post"> 送信(Origin: null)を模した経路でも
    // 通ることを確認する。
    const response = await client.postAsBrowserForm(`/e/${created.slug}/join`, {
      joinCode: created.joinCode,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${created.slug}/`);
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it("lets a cookie from a different event fall back to that event's own join page", async () => {
    const eventA = await createEvent({ title: "A" });
    const eventB = await createEvent({ title: "B" });
    // eventA の cookie は Path=/e/{eventA.slug} に限定されるが、テストクライアントは
    // cookie jar をパス無視で保持するため、middleware 側の `payload.e === event.id`
    // 照合(=セッションの取り違え防止)そのものを直接確認できる。
    const response = await eventA.client.get(`/e/${eventB.slug}/`, {
      redirect: "manual",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${eventB.slug}/join`);
  });

  it("rate limits after 10 failures for the same event, even with the right code on the 11th try", async () => {
    const created = await createEvent();
    const client = createTestClient();
    for (let i = 0; i < 10; i++) {
      const response = await client.post(`/e/${created.slug}/join`, {
        joinCode: "wrong-code",
      });
      expect(response.status).toBe(401);
    }
    const limited = await client.post(`/e/${created.slug}/join`, {
      joinCode: created.joinCode,
    });
    expect(limited.status).toBe(429);
  });

  it("does not count failures older than the 10 minute window", async () => {
    const created = await createEvent();
    const db = createDb(env.DB);
    const now = Math.floor(Date.now() / 1000);

    const rows = await db
      .select()
      .from(eventTable)
      .where(eq(eventTable.slug, created.slug));
    const eventId = rows[0]?.id;
    if (!eventId) {
      throw new Error("event not found");
    }

    for (let i = 0; i < 10; i++) {
      await db.insert(authFailure).values({
        id: newId(),
        eventId,
        ip: "unknown",
        kind: "join_code",
        createdAt: now - 601,
      });
    }

    const client = createTestClient();
    const response = await client.post(`/e/${created.slug}/join`, {
      joinCode: created.joinCode,
    });
    // 窓の外なのでレート制限に引っかからず、合言葉が正しければ通る。
    expect(response.status).toBe(303);
  });
});

describe("POST /e/:slug/session/rebind", () => {
  it("returns 204 and updates the cookie on a correct token", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await client.post(
      `/e/${created.slug}/session/rebind`,
      JSON.stringify({ token: created.token }),
      { headers: { "content-type": "application/json" } },
    );
    expect(response.status).toBe(204);

    // rebind 後は participant が紐付いた状態で曲一覧が見える。
    const songListResponse = await client.get(`/e/${created.slug}/`);
    const html = await songListResponse.text();
    expect(html).toContain('data-participant="');
    expect(html).not.toContain('data-participant="0"');
  });

  it("returns 401 on a wrong token", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await client.post(
      `/e/${created.slug}/session/rebind`,
      JSON.stringify({ token: "wrong-token" }),
      { headers: { "content-type": "application/json" } },
    );
    expect(response.status).toBe(401);
  });

  it("returns 401 and does not update the cookie when the token belongs to another event", async () => {
    const eventA = await createEvent({ title: "A" });
    const eventB = await createEvent({ title: "B" });

    // eventA の viewer が、eventB の主催者の token で eventA の rebind を叩く。
    const client = await joinAsViewer(eventA.slug, eventA.joinCode);
    const response = await client.post(
      `/e/${eventA.slug}/session/rebind`,
      JSON.stringify({ token: eventB.token }),
      { headers: { "content-type": "application/json" } },
    );
    expect(response.status).toBe(401);

    // cookie が更新されておらず、依然として未登録(participant なし)のまま。
    const songListResponse = await client.get(`/e/${eventA.slug}/`);
    const html = await songListResponse.text();
    expect(html).toContain('data-participant="0"');
  });
});
