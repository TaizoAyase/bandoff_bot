import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import { event as eventTable, participant } from "../../src/db/schema";
import {
  closeEvent,
  createEvent,
  createSong,
  findFirstSongSlotIds,
  joinAsViewer,
  registerParticipant,
} from "../helpers";

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
    expect(html).toContain('data-copy-target="recovery-key-display"');
  });

  it("shows the withdraw button and its data-confirm for a participant with no entries", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "山田" });

    const response = await client.get(`/e/${created.slug}/settings`);
    const html = await response.text();
    expect(html).toContain(`action="/e/${created.slug}/settings/withdraw"`);
    expect(html).toContain("参加を取りやめる");
    expect(html).toContain('data-confirm="参加を取りやめます"');
  });

  it("includes the entries in the withdraw confirm when the participant has any", async () => {
    const created = await createEvent();
    await createSong(created.client, created.slug, { title: "設定画面確認曲" });
    const slotId = (await findFirstSongSlotIds(created.slug))[0];
    if (!slotId) throw new Error("expected a slot");
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "山田" });
    await client.post(`/e/${created.slug}/slots/${slotId}/join`);

    const response = await client.get(`/e/${created.slug}/settings`);
    const html = await response.text();
    expect(html).toContain("設定画面確認曲");
    expect(html).toContain("も辞退します");
  });

  it("shows the protected message instead of a withdraw button for the organizer", async () => {
    const created = await createEvent();
    const response = await created.client.get(`/e/${created.slug}/settings`);
    const html = await response.text();
    expect(html).toContain("主催者は参加を取りやめられません");
    expect(html).not.toContain(`action="/e/${created.slug}/settings/withdraw"`);
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

  it("also clears the organizer flag, forbidding /organizer afterwards", async () => {
    const created = await createEvent();
    // createEvent の client は主催者(participant かつ o:true)を兼ねる。
    const response = await created.client.post(`/e/${created.slug}/settings/unbind`);
    expect(response.status).toBe(303);

    const organizerPage = await created.client.get(`/e/${created.slug}/organizer`);
    expect(organizerPage.status).toBe(403);

    // 主催者の participant 自体は消えない(cookie の紐付けが外れるだけ)。
    // 同一テストファイル内で D1 が共有されるため、eventId でスコープして確認する。
    const db = createDb(env.DB);
    const eventRows = await db
      .select()
      .from(eventTable)
      .where(eq(eventTable.slug, created.slug));
    const eventId = eventRows[0]?.id;
    if (!eventId) throw new Error("event not found");
    const rows = await db
      .select()
      .from(participant)
      .where(eq(participant.eventId, eventId));
    expect(rows.length).toBeGreaterThan(0);
  });
});
