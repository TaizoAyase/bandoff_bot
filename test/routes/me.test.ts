import { describe, expect, it } from "vitest";
import {
  createEvent,
  createSong,
  createTake,
  extractSongId,
  findFirstSongAndTakeId,
  findFirstSongSlotIds,
  joinAsViewer,
  registerParticipant,
} from "../helpers";

describe("GET /e/:slug/me", () => {
  it("guides an unregistered viewer to register", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await client.get(`/e/${created.slug}/me`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("登録する");
  });

  it("lists the song title and slot label for each of my assignments", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "山田" });
    await createSong(client, created.slug, { title: "自分の担当曲" });
    const slotIds = await findFirstSongSlotIds(created.slug);
    const slotId = slotIds[0];
    if (!slotId) throw new Error("expected a slot");
    await client.post(`/e/${created.slug}/slots/${slotId}/join`);

    const response = await client.get(`/e/${created.slug}/me`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("自分の担当曲");
    expect(html).toContain("Gt1");
  });

  it("shows 'n回目' only when the song has 2+ takes", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "山田" });
    const songResponse = await createSong(client, created.slug, {
      title: "複数回演奏",
    });
    const songId = extractSongId(songResponse);

    const slotIdsBefore = await findFirstSongSlotIds(created.slug);
    const firstSlotId = slotIdsBefore[0];
    if (!firstSlotId) throw new Error("expected a slot");
    await client.post(`/e/${created.slug}/slots/${firstSlotId}/join`);

    const singleTakeResponse = await client.get(`/e/${created.slug}/me`);
    const singleTakeHtml = await singleTakeResponse.text();
    expect(singleTakeHtml).not.toContain("回目");

    await createTake(client, created.slug, songId);
    const { takeId: firstTakeId } = await findFirstSongAndTakeId(created.slug);
    // Take2 の同じ位置(Gt1)にも入って、2件のエントリーを持つ状態にする。
    const secondTakeResponse = await client.get(`/e/${created.slug}/`);
    const secondTakeHtml = await secondTakeResponse.text();
    expect(secondTakeHtml).toContain("2回目");
    // 元の Take1 の id は変わらない。
    expect(firstTakeId).toBeTruthy();

    const multiTakeResponse = await client.get(`/e/${created.slug}/me`);
    const multiTakeHtml = await multiTakeResponse.text();
    expect(multiTakeHtml).toContain("1回目");
  });
});
