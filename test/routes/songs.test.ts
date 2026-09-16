import { env } from "cloudflare:test";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import {
  assignment,
  event as eventTable,
  slot,
  song,
  songScoreUrl,
  take,
} from "../../src/db/schema";
import { LIMITS } from "../../src/domain/validation";
import {
  type CreateEventOptions,
  closeEvent,
  createEvent,
  createSong,
  createTestClient,
  editSong,
  extractSongId,
  findFirstSongSlotIds,
  joinAsViewer,
  registerParticipant,
} from "../helpers";

async function createEventWithParticipant(options: CreateEventOptions = {}) {
  const created = await createEvent(options);
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
    // ブラウザの <form method="post"> 送信(Origin: null)を模した経路でも
    // 通ることを確認する。
    const response = await createSong(setup.client, setup.slug, {
      title: "曲A",
      useBrowserForm: true,
    });
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

  it("saves score URLs in input order with 1-based sort_order", async () => {
    const setup = await createEventWithParticipant();
    const response = await createSong(setup.client, setup.slug, {
      scoreUrls: ["https://example.com/b", "https://example.com/a"],
    });
    const songId = extractSongId(response);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(songScoreUrl)
      .where(eq(songScoreUrl.songId, songId))
      .orderBy(asc(songScoreUrl.sortOrder));
    expect(rows.map((r) => r.url)).toEqual([
      "https://example.com/b",
      "https://example.com/a",
    ]);
    expect(rows.map((r) => r.sortOrder)).toEqual([1, 2]);
  });

  it("keeps only non-blank score URL rows", async () => {
    const setup = await createEventWithParticipant();
    const response = await createSong(setup.client, setup.slug, {
      scoreUrls: ["https://example.com/a", "", "  "],
    });
    const songId = extractSongId(response);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(songScoreUrl)
      .where(eq(songScoreUrl.songId, songId));
    expect(rows).toHaveLength(1);
  });

  it("rejects an invalid score URL, echoes input, and creates no song", async () => {
    const setup = await createEventWithParticipant();
    const response = await createSong(setup.client, setup.slug, {
      title: "不正URL曲",
      scoreUrls: ["not a url"],
    });
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain("譜面URLの形式が正しくありません");
    expect(html).toContain("not a url");

    const db = createDb(env.DB);
    const rows = await db.select().from(song).where(eq(song.title, "不正URL曲"));
    expect(rows).toHaveLength(0);
  });

  it("rejects more than 10 score URLs", async () => {
    const setup = await createEventWithParticipant();
    const tooMany = Array.from(
      { length: LIMITS.MAX_SCORE_URLS_PER_SONG + 1 },
      (_, i) => `https://example.com/${i}`,
    );
    const response = await createSong(setup.client, setup.slug, {
      scoreUrls: tooMany,
    });
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain("譜面URLは10件までです");
  });

  it("still succeeds when scoreUrl is not sent at all (backward compatible)", async () => {
    const setup = await createEventWithParticipant();
    const response = await createSong(setup.client, setup.slug, {});
    expect(response.status).toBe(303);
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

  it("does not include the event info block (name/schedule/place)", async () => {
    const setup = await createEventWithParticipant({
      title: "断片には出ないはずのイベント名",
      place: "断片には出ないはずの場所",
    });

    const response = await setup.client.get(`/e/${setup.slug}/fragments/songs`);
    const html = await response.text();
    expect(html).not.toContain("断片には出ないはずのイベント名");
    expect(html).not.toContain("断片には出ないはずの場所");
    expect(html).not.toContain('class="event-info"');

    // 曲一覧本体(#song-list の外側)には出ていることの対照確認。
    const fullPage = await setup.client.get(`/e/${setup.slug}/`);
    const fullHtml = await fullPage.text();
    expect(fullHtml).toContain("断片には出ないはずのイベント名");
    expect(fullHtml).toContain("断片には出ないはずの場所");
  });

  it("returns 401 for a request without a valid viewer cookie", async () => {
    const created = await createEvent();
    const client = createTestClient();
    const response = await client.get(`/e/${created.slug}/fragments/songs`);
    expect(response.status).toBe(401);
  });
});

describe("曲の編集(GET/POST /e/:slug/songs/:id/edit, /e/:slug/songs/:id)", () => {
  it("lets the proposer edit their own song", async () => {
    const setup = await createEventWithParticipant();
    const response = await createSong(setup.client, setup.slug, { title: "編集前" });
    const songId = extractSongId(response);

    const getResponse = await setup.client.get(`/e/${setup.slug}/songs/${songId}/edit`);
    expect(getResponse.status).toBe(200);

    const postResponse = await setup.client.post(`/e/${setup.slug}/songs/${songId}`, {
      title: "編集後",
      artist: "",
      refUrl: "",
      songKey: "",
      notes: "",
    });
    expect(postResponse.status).toBe(303);

    const db = createDb(env.DB);
    const rows = await db.select().from(song).where(eq(song.id, songId));
    expect(rows[0]?.title).toBe("編集後");
  });

  it("forbids someone else's edit attempt", async () => {
    const setup = await createEventWithParticipant();
    const response = await createSong(setup.client, setup.slug, { title: "他人の曲" });
    const songId = extractSongId(response);

    const other = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(other, setup.slug, { displayName: "別の人" });

    const getResponse = await other.get(`/e/${setup.slug}/songs/${songId}/edit`);
    expect(getResponse.status).toBe(403);

    const postResponse = await other.post(`/e/${setup.slug}/songs/${songId}`, {
      title: "改ざん",
      artist: "",
      refUrl: "",
      songKey: "",
      notes: "",
    });
    expect(postResponse.status).toBe(403);

    const db = createDb(env.DB);
    const rows = await db.select().from(song).where(eq(song.id, songId));
    expect(rows[0]?.title).toBe("他人の曲");
  });

  it("allows the organizer to edit someone else's song", async () => {
    const created = await createEvent();
    const participant = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(participant, created.slug, { displayName: "山田" });
    const response = await createSong(participant, created.slug, { title: "曲" });
    const songId = extractSongId(response);

    const organizerResponse = await created.client.post(
      `/e/${created.slug}/songs/${songId}`,
      { title: "主催者が編集", artist: "", refUrl: "", songKey: "", notes: "" },
    );
    expect(organizerResponse.status).toBe(303);

    const db = createDb(env.DB);
    const rows = await db.select().from(song).where(eq(song.id, songId));
    expect(rows[0]?.title).toBe("主催者が編集");
  });

  it("shows existing score URLs as input values on the edit form", async () => {
    const setup = await createEventWithParticipant();
    const response = await createSong(setup.client, setup.slug, {
      title: "既存譜面URLあり",
      scoreUrls: ["https://example.com/a", "https://example.com/b"],
    });
    const songId = extractSongId(response);

    const getResponse = await setup.client.get(`/e/${setup.slug}/songs/${songId}/edit`);
    const html = await getResponse.text();
    expect(html).toContain('value="https://example.com/a"');
    expect(html).toContain('value="https://example.com/b"');
  });

  it("replaces score URLs on edit (2 -> 1)", async () => {
    const setup = await createEventWithParticipant();
    const response = await createSong(setup.client, setup.slug, {
      title: "編集で差し替え",
      scoreUrls: ["https://example.com/old1", "https://example.com/old2"],
    });
    const songId = extractSongId(response);

    const postResponse = await editSong(setup.client, setup.slug, songId, {
      scoreUrls: ["https://example.com/new"],
    });
    expect(postResponse.status).toBe(303);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(songScoreUrl)
      .where(eq(songScoreUrl.songId, songId))
      .orderBy(asc(songScoreUrl.sortOrder));
    expect(rows.map((r) => r.url)).toEqual(["https://example.com/new"]);
  });

  it("removes all score URLs when none are sent on edit", async () => {
    const setup = await createEventWithParticipant();
    const response = await createSong(setup.client, setup.slug, {
      title: "編集で全削除",
      scoreUrls: ["https://example.com/a"],
    });
    const songId = extractSongId(response);

    const postResponse = await editSong(setup.client, setup.slug, songId, {});
    expect(postResponse.status).toBe(303);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(songScoreUrl)
      .where(eq(songScoreUrl.songId, songId));
    expect(rows).toHaveLength(0);
  });

  it("saves a single score URL sent alone (parseBody({ all: true }) regression check)", async () => {
    const setup = await createEventWithParticipant();
    const response = await createSong(setup.client, setup.slug, {
      title: "1本だけ送る",
    });
    const songId = extractSongId(response);

    const postResponse = await editSong(setup.client, setup.slug, songId, {
      scoreUrls: ["https://example.com/single"],
    });
    expect(postResponse.status).toBe(303);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(songScoreUrl)
      .where(eq(songScoreUrl.songId, songId));
    expect(rows.map((r) => r.url)).toEqual(["https://example.com/single"]);
  });
});

describe("曲の削除(POST /e/:slug/songs/:id/delete)", () => {
  it("lets the proposer delete their own empty song", async () => {
    const setup = await createEventWithParticipant();
    const response = await createSong(setup.client, setup.slug, { title: "削除対象" });
    const songId = extractSongId(response);

    const deleteResponse = await setup.client.post(
      `/e/${setup.slug}/songs/${songId}/delete`,
    );
    expect(deleteResponse.status).toBe(303);

    const db = createDb(env.DB);
    const rows = await db.select().from(song).where(eq(song.id, songId));
    expect(rows).toHaveLength(0);
  });

  it("forbids deleting someone else's song", async () => {
    const setup = await createEventWithParticipant();
    const response = await createSong(setup.client, setup.slug, { title: "他人の曲" });
    const songId = extractSongId(response);

    const other = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(other, setup.slug, { displayName: "別の人" });
    const deleteResponse = await other.post(`/e/${setup.slug}/songs/${songId}/delete`);
    expect(deleteResponse.status).toBe(403);

    const db = createDb(env.DB);
    const rows = await db.select().from(song).where(eq(song.id, songId));
    expect(rows).toHaveLength(1);
  });

  it("forbids the proposer from deleting a song that has an assignment", async () => {
    const setup = await createEventWithParticipant();
    const response = await createSong(setup.client, setup.slug, {
      title: "エントリー済み",
    });
    const songId = extractSongId(response);
    const takeRows = await createDb(env.DB)
      .select()
      .from(take)
      .where(eq(take.songId, songId));
    const slotRows = await createDb(env.DB)
      .select()
      .from(slot)
      .where(eq(slot.takeId, takeRows[0]?.id ?? ""));
    const slotId = slotRows[0]?.id;
    if (!slotId) throw new Error("expected a slot");
    await setup.client.post(`/e/${setup.slug}/slots/${slotId}/join`);

    const deleteResponse = await setup.client.post(
      `/e/${setup.slug}/songs/${songId}/delete`,
    );
    expect(deleteResponse.status).toBe(403);
  });

  it("allows the organizer to delete any song, cascading to takes/slots", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "山田" });
    const response = await createSong(client, created.slug, {
      title: "主催者が消す曲",
    });
    const songId = extractSongId(response);

    const deleteResponse = await created.client.post(
      `/e/${created.slug}/songs/${songId}/delete`,
    );
    expect(deleteResponse.status).toBe(303);

    const db = createDb(env.DB);
    const songRows = await db.select().from(song).where(eq(song.id, songId));
    expect(songRows).toHaveLength(0);
    const takeRows = await db.select().from(take).where(eq(take.songId, songId));
    expect(takeRows).toHaveLength(0);
  });

  it("is forbidden for participants once the event is closed", async () => {
    const setup = await createEventWithParticipant();
    const response = await createSong(setup.client, setup.slug, { title: "closed曲" });
    const songId = extractSongId(response);
    await closeEvent(setup.slug);

    const deleteResponse = await setup.client.post(
      `/e/${setup.slug}/songs/${songId}/delete`,
    );
    expect(deleteResponse.status).toBe(403);
  });

  it("cascades to song_score_url when a song is deleted", async () => {
    const setup = await createEventWithParticipant();
    const response = await createSong(setup.client, setup.slug, {
      title: "譜面URLごと削除",
      scoreUrls: ["https://example.com/a", "https://example.com/b"],
    });
    const songId = extractSongId(response);

    const deleteResponse = await setup.client.post(
      `/e/${setup.slug}/songs/${songId}/delete`,
    );
    expect(deleteResponse.status).toBe(303);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(songScoreUrl)
      .where(eq(songScoreUrl.songId, songId));
    expect(rows).toHaveLength(0);
  });
});

describe("曲一覧の表示に譜面URLが出る", () => {
  it("shows numbered score links with rel=noreferrer", async () => {
    const setup = await createEventWithParticipant();
    await createSong(setup.client, setup.slug, {
      title: "表示確認曲",
      scoreUrls: ["https://example.com/a", "https://example.com/b"],
    });

    const response = await setup.client.get(`/e/${setup.slug}/`);
    const html = await response.text();
    expect(html).toContain(">譜面1<");
    expect(html).toContain(">譜面2<");
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('href="https://example.com/b"');
    expect(html).toContain('rel="noreferrer"');
  });

  it("shows a fragment score link on the polling fragment endpoint", async () => {
    const setup = await createEventWithParticipant();
    await createSong(setup.client, setup.slug, {
      title: "断片譜面確認曲",
      scoreUrls: ["https://example.com/a"],
    });

    const response = await setup.client.get(`/e/${setup.slug}/fragments/songs`);
    const html = await response.text();
    expect(html).toContain(">譜面1<");
    expect(html).toContain('rel="noreferrer"');
  });
});

/** イベント B の song_id を、イベント A の cookie で叩いたときの eventId 照合を確認する。 */
async function setupCrossEventSongs() {
  const eventA = await createEventWithParticipant();
  await createSong(eventA.client, eventA.slug, { title: "Aの曲" });

  const eventB = await createEventWithParticipant();
  const songBResponse = await createSong(eventB.client, eventB.slug, {
    title: "Bの曲",
  });
  const songBId = extractSongId(songBResponse);

  return { eventA, eventB, songBId };
}

describe("クロスイベント: イベント B の song_id をイベント A の cookie で操作する", () => {
  it("曲編集フォーム(GET)は404になる", async () => {
    const { eventA, songBId } = await setupCrossEventSongs();
    const response = await eventA.client.get(`/e/${eventA.slug}/songs/${songBId}/edit`);
    expect(response.status).toBe(404);
  });

  it("曲編集(POST)は404になり、B の曲は変更されない", async () => {
    const { eventA, songBId } = await setupCrossEventSongs();
    const response = await eventA.client.post(`/e/${eventA.slug}/songs/${songBId}`, {
      title: "改ざん",
      artist: "",
      refUrl: "",
      songKey: "",
      notes: "",
    });
    expect(response.status).toBe(404);

    const db = createDb(env.DB);
    const rows = await db.select().from(song).where(eq(song.id, songBId));
    expect(rows[0]?.title).toBe("Bの曲");
  });

  it("曲削除は404になり、B の曲は削除されない", async () => {
    const { eventA, songBId } = await setupCrossEventSongs();
    const response = await eventA.client.post(
      `/e/${eventA.slug}/songs/${songBId}/delete`,
    );
    expect(response.status).toBe(404);

    const db = createDb(env.DB);
    const rows = await db.select().from(song).where(eq(song.id, songBId));
    expect(rows).toHaveLength(1);
  });
});

describe("クロスイベント: イベント B の participant_id を指定した代理エントリー・代理辞退", () => {
  it("代理 join は404になり、B の枠に assignment は増えない", async () => {
    const eventA = await createEvent();
    const eventB = await createEventWithParticipant();
    await createSong(eventB.client, eventB.slug, { title: "B曲(代理join)" });
    const slotIdsB = await findFirstSongSlotIds(eventB.slug);
    const slotBId = slotIdsB[0];
    if (!slotBId) throw new Error("expected a slot");

    const listResponse = await eventB.client.get(`/e/${eventB.slug}/`);
    const html = await listResponse.text();
    const match = /data-participant="([^"]*)"/.exec(html);
    const participantBId = match?.[1];
    if (!participantBId || participantBId === "0") {
      throw new Error("could not extract participant id");
    }

    // eventA の主催者が、eventA の slug で eventB の slot_id / participant_id を叩く。
    const response = await eventA.client.post(
      `/e/${eventA.slug}/slots/${slotBId}/join`,
      { participantId: participantBId },
    );
    expect(response.status).toBe(404);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(assignment)
      .where(eq(assignment.slotId, slotBId));
    expect(rows).toHaveLength(0);
  });

  it("代理 leave は404になり、B のエントリーは残る", async () => {
    const eventA = await createEvent();
    const eventB = await createEventWithParticipant();
    await createSong(eventB.client, eventB.slug, { title: "B曲(代理leave)" });
    const slotIdsB = await findFirstSongSlotIds(eventB.slug);
    const slotBId = slotIdsB[0];
    if (!slotBId) throw new Error("expected a slot");
    await eventB.client.post(`/e/${eventB.slug}/slots/${slotBId}/join`);

    const response = await eventA.client.post(
      `/e/${eventA.slug}/slots/${slotBId}/leave`,
    );
    expect(response.status).toBe(404);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(assignment)
      .where(eq(assignment.slotId, slotBId));
    expect(rows).toHaveLength(1);
  });
});
