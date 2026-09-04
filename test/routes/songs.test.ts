import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import { event as eventTable, slot, take } from "../../src/db/schema";
import { LIMITS } from "../../src/domain/validation";
import {
  createEvent,
  createSong,
  createTestClient,
  joinAsViewer,
  registerParticipant,
} from "../helpers";

async function createEventWithParticipant() {
  const created = await createEvent();
  const client = await joinAsViewer(created.slug, created.joinCode);
  await registerParticipant(client, created.slug, { displayName: "山田" });
  return { ...created, client };
}

describe("GET /e/:slug/songs/new", () => {
  it("redirects an unregistered viewer to /register", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await client.get(`/e/${created.slug}/songs/new`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${created.slug}/register`);
  });

  it("shows the form to a registered participant", async () => {
    const setup = await createEventWithParticipant();
    const response = await setup.client.get(`/e/${setup.slug}/songs/new`);
    expect(response.status).toBe(200);
  });
});

describe("POST /e/:slug/songs", () => {
  it("creates a song with Take1 and 5 default slots", async () => {
    const setup = await createEventWithParticipant();
    const response = await createSong(setup.client, setup.slug, { title: "曲A" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(
      new RegExp(`^/e/${setup.slug}/#song-`),
    );

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(eventTable)
      .where(eq(eventTable.slug, setup.slug));
    const eventId = rows[0]?.id;
    if (!eventId) throw new Error("event not found");

    const takeRows = await db.select().from(take);
    expect(takeRows).toHaveLength(1);
    const slotRows = await db
      .select()
      .from(slot)
      .where(eq(slot.takeId, takeRows[0]?.id ?? ""));
    expect(slotRows).toHaveLength(5);
  });

  it("redirects an unregistered viewer to /register", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await createSong(client, created.slug);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${created.slug}/register`);
  });

  it("rejects when the party composition has zero non-empty slots", async () => {
    const setup = await createEventWithParticipant();
    const response = await createSong(setup.client, setup.slug, { instruments: [] });
    expect(response.status).toBe(400);
  });

  it("rejects when the party composition exceeds the per-take slot limit", async () => {
    const setup = await createEventWithParticipant();
    const tooMany = Array.from({ length: LIMITS.MAX_SLOTS_PER_TAKE + 1 }, () => "Gt");
    const response = await createSong(setup.client, setup.slug, {
      instruments: tooMany,
    });
    expect(response.status).toBe(400);
  });

  it("is forbidden for participants once the event is closed", async () => {
    const setup = await createEventWithParticipant();
    const db = createDb(env.DB);
    await db
      .update(eventTable)
      .set({ status: "closed" })
      .where(eq(eventTable.slug, setup.slug));

    const response = await createSong(setup.client, setup.slug);
    expect(response.status).toBe(403);
  });
});

describe("GET /e/:slug/fragments/songs", () => {
  it("returns just the song list fragment for a viewer", async () => {
    const setup = await createEventWithParticipant();
    await createSong(setup.client, setup.slug, { title: "断片テスト曲" });

    const response = await setup.client.get(`/e/${setup.slug}/fragments/songs`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain("断片テスト曲");
    expect(html).not.toContain("<!doctype html>");
    expect(html).not.toContain("<html");
  });

  it("returns 401 for a request without a valid viewer cookie", async () => {
    const created = await createEvent();
    const client = createTestClient();
    const response = await client.get(`/e/${created.slug}/fragments/songs`);
    expect(response.status).toBe(401);
  });
});
