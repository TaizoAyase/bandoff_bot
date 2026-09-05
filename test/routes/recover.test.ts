import { describe, expect, it } from "vitest";
import { createEvent, createTestClient } from "../helpers";

describe("GET /e/:slug/recover", () => {
  it("shows the recovery key form", async () => {
    const created = await createEvent();
    const client = createTestClient();
    await client.post(`/e/${created.slug}/join`, { joinCode: created.joinCode });
    const response = await client.get(`/e/${created.slug}/recover`);
    expect(response.status).toBe(200);
  });
});

describe("POST /e/:slug/recover", () => {
  it("recovers with the correct recovery key, issuing a new token", async () => {
    const created = await createEvent();
    const client = createTestClient();
    await client.post(`/e/${created.slug}/join`, { joinCode: created.joinCode });

    const response = await client.post(`/e/${created.slug}/recover`, {
      recoveryKey: created.recoveryKey,
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    const tokenMatch = /data-token="([^"]*)"/.exec(html);
    const newToken = tokenMatch?.[1];
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(created.token);

    // 復帰後は participant が紐付いた状態で曲一覧が見える。
    const listResponse = await client.get(`/e/${created.slug}/`);
    const listHtml = await listResponse.text();
    expect(listHtml).not.toContain('data-participant="0"');
  });

  it("rejects the old token for /session/rebind after recovery replaced it", async () => {
    const created = await createEvent();
    const recoverClient = createTestClient();
    await recoverClient.post(`/e/${created.slug}/join`, { joinCode: created.joinCode });
    await recoverClient.post(`/e/${created.slug}/recover`, {
      recoveryKey: created.recoveryKey,
    });

    const anotherViewer = createTestClient();
    await anotherViewer.post(`/e/${created.slug}/join`, { joinCode: created.joinCode });
    const rebindResponse = await anotherViewer.post(
      `/e/${created.slug}/session/rebind`,
      JSON.stringify({ token: created.token }),
      { headers: { "content-type": "application/json" } },
    );
    expect(rebindResponse.status).toBe(401);
  });

  it("returns 401 on a wrong recovery key", async () => {
    const created = await createEvent();
    const client = createTestClient();
    await client.post(`/e/${created.slug}/join`, { joinCode: created.joinCode });
    const response = await client.post(`/e/${created.slug}/recover`, {
      recoveryKey: "0000-0000-0000",
    });
    expect(response.status).toBe(401);
  });

  it("accepts a normalized form (lowercase, no hyphens)", async () => {
    const created = await createEvent();
    const client = createTestClient();
    await client.post(`/e/${created.slug}/join`, { joinCode: created.joinCode });
    const normalized = created.recoveryKey.toLowerCase().replace(/-/g, "");
    const response = await client.post(`/e/${created.slug}/recover`, {
      recoveryKey: normalized,
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("data-token=");
  });

  it("returns 401 for a recovery key that belongs to a different event", async () => {
    const eventA = await createEvent({ title: "A" });
    const eventB = await createEvent({ title: "B" });
    const client = createTestClient();
    await client.post(`/e/${eventA.slug}/join`, { joinCode: eventA.joinCode });
    const response = await client.post(`/e/${eventA.slug}/recover`, {
      recoveryKey: eventB.recoveryKey,
    });
    expect(response.status).toBe(401);
  });

  it("rate limits after 10 failures, even with the right key on the 11th try", async () => {
    const created = await createEvent();
    const client = createTestClient();
    await client.post(`/e/${created.slug}/join`, { joinCode: created.joinCode });
    for (let i = 0; i < 10; i++) {
      const response = await client.post(`/e/${created.slug}/recover`, {
        recoveryKey: "0000-0000-0000",
      });
      expect(response.status).toBe(401);
    }
    const limited = await client.post(`/e/${created.slug}/recover`, {
      recoveryKey: created.recoveryKey,
    });
    expect(limited.status).toBe(429);
  });
});
