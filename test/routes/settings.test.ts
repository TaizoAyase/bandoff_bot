import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import { participant } from "../../src/db/schema";
import { closeEvent, createEvent, joinAsViewer, registerParticipant } from "../helpers";

describe("GET /e/:slug/settings", () => {
  it("shows a registration prompt for an unregistered viewer", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await client.get(`/e/${created.slug}/settings`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("参加登録すると");
    expect(html).not.toContain('name="displayName"');
  });

  it("shows the profile form for a registered participant", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, {
      displayName: "山田",
      instruments: "Gt",
    });
    const response = await client.get(`/e/${created.slug}/settings`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('value="山田"');
    expect(html).toContain("紐付けを解除する");
  });
});

describe("POST /e/:slug/settings/profile", () => {
  it("updates the display name and instruments", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "変更前" });

    const response = await client.post(`/e/${created.slug}/settings/profile`, {
      displayName: "変更後",
      instruments: "Dr, Cho",
    });
    expect(response.status).toBe(303);

    const db = createDb(env.DB);
    const rows = await db.select().from(participant);
    const updated = rows.find((p) => p.displayName === "変更後");
    expect(updated).toBeDefined();
    expect(updated?.instruments).toEqual(["Dr", "Cho"]);
  });

  it("warns on a duplicate display name and proceeds with confirm=1", async () => {
    const created = await createEvent({ organizerDisplayName: "山田" });
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "鈴木" });

    const warnResponse = await client.post(`/e/${created.slug}/settings/profile`, {
      displayName: "山田",
      instruments: "",
    });
    expect(warnResponse.status).toBe(200);
    const warnHtml = await warnResponse.text();
    expect(warnHtml).toContain("既に使われています");

    const confirmResponse = await client.post(`/e/${created.slug}/settings/profile`, {
      displayName: "山田",
      instruments: "",
      confirm: "1",
    });
    expect(confirmResponse.status).toBe(303);
  });

  it("does not warn when the display name is unchanged", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "山田" });

    const response = await client.post(`/e/${created.slug}/settings/profile`, {
      displayName: "山田",
      instruments: "Ba",
    });
    expect(response.status).toBe(303);
  });

  it("is forbidden once the event is closed", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "山田" });
    await closeEvent(created.slug);

    const response = await client.post(`/e/${created.slug}/settings/profile`, {
      displayName: "変更後",
      instruments: "",
    });
    expect(response.status).toBe(403);
  });

  it("redirects an unregistered viewer to /register", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await client.post(`/e/${created.slug}/settings/profile`, {
      displayName: "誰か",
      instruments: "",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${created.slug}/register`);
  });
});

describe("POST /e/:slug/settings/unbind", () => {
  it("clears the participant from the session cookie", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "山田" });

    const before = await client.get(`/e/${created.slug}/`);
    const beforeHtml = await before.text();
    expect(beforeHtml).not.toContain('data-participant="0"');

    const response = await client.post(`/e/${created.slug}/settings/unbind`);
    expect(response.status).toBe(303);

    const after = await client.get(`/e/${created.slug}/`);
    const afterHtml = await after.text();
    expect(afterHtml).toContain('data-participant="0"');
  });

  it("redirects an unregistered viewer to /register (nothing to unbind)", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await client.post(`/e/${created.slug}/settings/unbind`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${created.slug}/register`);
  });
});
