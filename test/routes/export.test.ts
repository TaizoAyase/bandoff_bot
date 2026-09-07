import { describe, expect, it } from "vitest";
import { createEvent, createSong, joinAsViewer, registerParticipant } from "../helpers";

describe("GET /e/:slug/export.json", () => {
  it("returns 200 with attachment headers for the organizer", async () => {
    const created = await createEvent();
    const response = await created.client.get(`/e/${created.slug}/export.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain(`bandoff-${created.slug.slice(0, 8)}.json`);
  });

  it("is forbidden for a registered participant who is not the organizer", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "山田" });
    const response = await client.get(`/e/${created.slug}/export.json`);
    expect(response.status).toBe(403);
  });

  it("is forbidden for an unregistered viewer", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await client.get(`/e/${created.slug}/export.json`);
    expect(response.status).toBe(403);
  });

  it("does not include join_code, hashes, or the organizer key hash", async () => {
    const created = await createEvent();
    await createSong(created.client, created.slug, { title: "エクスポート対象曲" });
    const response = await created.client.get(`/e/${created.slug}/export.json`);
    const text = await response.text();

    expect(text).not.toContain(created.joinCode);
    expect(text).not.toContain("organizer_key_hash");
    expect(text).not.toContain("organizerKeyHash");
    expect(text).not.toContain(created.organizerKey);
    expect(text).not.toContain("token_hash");
    expect(text).not.toContain("tokenHash");
    expect(text).not.toContain("recovery_key_hash");
    expect(text).not.toContain("recoveryKeyHash");
    expect(text).not.toContain("joinCode");
    expect(text).not.toContain("join_code");
  });

  it("includes the song/take/slot/assignment tree and the participants list", async () => {
    const created = await createEvent();
    await createSong(created.client, created.slug, { title: "曲ツリー確認" });
    const response = await created.client.get(`/e/${created.slug}/export.json`);
    const data = (await response.json()) as {
      event: { title: string };
      participants: { displayName: string }[];
      songs: { title: string; takes: unknown[] }[];
    };

    expect(data.event.title).toBeTruthy();
    expect(data.participants.length).toBeGreaterThan(0);
    const song = data.songs.find((s) => s.title === "曲ツリー確認");
    expect(song).toBeDefined();
    expect(song?.takes.length).toBeGreaterThan(0);
  });

  it("includes durationMinutes in the event data", async () => {
    const created = await createEvent({ durationMinutes: "180" });
    const response = await created.client.get(`/e/${created.slug}/export.json`);
    const data = (await response.json()) as {
      event: { durationMinutes: number | null };
    };
    expect(data.event.durationMinutes).toBe(180);
  });
});
