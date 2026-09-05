import { env } from "cloudflare:test";
import { asc, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import { assignment, slot, take } from "../../src/db/schema";
import { LIMITS } from "../../src/domain/validation";
import {
  closeEvent,
  createEvent,
  createSlot,
  createSong,
  createTake,
  extractSongId,
  findFirstSongAndTakeId,
  findFirstSongSlotIds,
  joinAsViewer,
  registerParticipant,
} from "../helpers";

async function setupEventWithSong() {
  const created = await createEvent();
  const response = await createSong(created.client, created.slug, {
    title: "テスト曲",
  });
  const songId = extractSongId(response);
  const { takeId } = await findFirstSongAndTakeId(created.slug);
  return { ...created, songId, takeId };
}

/** organizer とは別に、登録済みの一般参加者クライアントも用意する。 */
async function setupEventWithSongAndParticipant() {
  const setup = await setupEventWithSong();
  const participantClient = await joinAsViewer(setup.slug, setup.joinCode);
  await registerParticipant(participantClient, setup.slug, { displayName: "参加者A" });
  return { ...setup, participantClient };
}

describe("POST /e/:slug/songs/:id/takes", () => {
  it("duplicates Take1's slot composition with empty assignments", async () => {
    const setup = await setupEventWithSong();
    const response = await createTake(setup.client, setup.slug, setup.songId);
    expect(response.status).toBe(303);

    const db = createDb(env.DB);
    const takeRows = await db.select().from(take).where(eq(take.songId, setup.songId));
    expect(takeRows).toHaveLength(2);

    const newTake = takeRows.find((t) => t.id !== setup.takeId);
    if (!newTake) throw new Error("expected a new take");
    const newSlots = await db
      .select()
      .from(slot)
      .where(eq(slot.takeId, newTake.id))
      .orderBy(asc(slot.sortOrder));
    expect(newSlots).toHaveLength(5);
    expect(newSlots.map((s) => s.instrument)).toEqual(["Gt", "Gt", "Ba", "Dr", "Vo"]);

    // 新しい Take の枠には誰も入っていない(担当者は複製されない)。
    const newSlotIds = newSlots.map((s) => s.id);
    const assignmentRows = await db
      .select()
      .from(assignment)
      .where(inArray(assignment.slotId, newSlotIds));
    expect(assignmentRows).toHaveLength(0);
  });

  it("shows the '1回目/2回目' headings once a 2nd take exists", async () => {
    const setup = await setupEventWithSong();
    await createTake(setup.client, setup.slug, setup.songId);
    const listResponse = await setup.client.get(`/e/${setup.slug}/`);
    const html = await listResponse.text();
    expect(html).toContain("1回目");
    expect(html).toContain("2回目");
  });

  it("does not show take headings with a single take", async () => {
    const setup = await setupEventWithSong();
    const listResponse = await setup.client.get(`/e/${setup.slug}/`);
    const html = await listResponse.text();
    expect(html).not.toContain("1回目");
  });

  it("rejects once the per-song take limit is reached", async () => {
    const setup = await setupEventWithSong();
    for (let i = 1; i < LIMITS.MAX_TAKES_PER_SONG; i++) {
      const response = await createTake(setup.client, setup.slug, setup.songId);
      expect(response.status).toBe(303);
    }
    const overLimit = await createTake(setup.client, setup.slug, setup.songId);
    expect(overLimit.status).toBe(400);

    const db = createDb(env.DB);
    const takeRows = await db.select().from(take).where(eq(take.songId, setup.songId));
    expect(takeRows).toHaveLength(LIMITS.MAX_TAKES_PER_SONG);
  });

  it("redirects an unregistered viewer to /register", async () => {
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    const response = await createTake(client, setup.slug, setup.songId);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${setup.slug}/register`);
  });

  it("is forbidden for a participant once the event is closed", async () => {
    const setup = await setupEventWithSongAndParticipant();
    await closeEvent(setup.slug);
    const response = await createTake(
      setup.participantClient,
      setup.slug,
      setup.songId,
    );
    expect(response.status).toBe(403);
  });
});

describe("POST /e/:slug/takes/:id/delete", () => {
  it("cannot delete the only take, even for the organizer", async () => {
    const setup = await setupEventWithSong();
    const response = await setup.client.post(
      `/e/${setup.slug}/takes/${setup.takeId}/delete`,
    );
    expect(response.status).toBe(403);

    const db = createDb(env.DB);
    const takeRows = await db.select().from(take).where(eq(take.songId, setup.songId));
    expect(takeRows).toHaveLength(1);
  });

  it("allows a participant to delete a 2nd take when all its slots are empty", async () => {
    const setup = await setupEventWithSongAndParticipant();
    await createTake(setup.client, setup.slug, setup.songId);
    const db = createDb(env.DB);
    const takeRows = await db.select().from(take).where(eq(take.songId, setup.songId));
    const secondTake = takeRows.find((t) => t.id !== setup.takeId);
    if (!secondTake) throw new Error("expected a second take");

    const response = await setup.participantClient.post(
      `/e/${setup.slug}/takes/${secondTake.id}/delete`,
    );
    expect(response.status).toBe(303);

    const remaining = await db.select().from(take).where(eq(take.songId, setup.songId));
    expect(remaining).toHaveLength(1);
  });

  it("forbids a participant from deleting a take that has a filled slot", async () => {
    const setup = await setupEventWithSongAndParticipant();
    await createTake(setup.client, setup.slug, setup.songId);
    const db = createDb(env.DB);
    const takeRows = await db.select().from(take).where(eq(take.songId, setup.songId));
    const secondTake = takeRows.find((t) => t.id !== setup.takeId);
    if (!secondTake) throw new Error("expected a second take");
    const slotRows = await db.select().from(slot).where(eq(slot.takeId, secondTake.id));
    const slotId = slotRows[0]?.id;
    if (!slotId) throw new Error("expected a slot");
    await setup.participantClient.post(`/e/${setup.slug}/slots/${slotId}/join`);

    const response = await setup.participantClient.post(
      `/e/${setup.slug}/takes/${secondTake.id}/delete`,
    );
    expect(response.status).toBe(403);
  });

  it("allows the organizer to delete a 2nd take even when a slot is filled", async () => {
    const setup = await setupEventWithSongAndParticipant();
    await createTake(setup.client, setup.slug, setup.songId);
    const db = createDb(env.DB);
    const takeRows = await db.select().from(take).where(eq(take.songId, setup.songId));
    const secondTake = takeRows.find((t) => t.id !== setup.takeId);
    if (!secondTake) throw new Error("expected a second take");
    const slotRows = await db.select().from(slot).where(eq(slot.takeId, secondTake.id));
    const slotId = slotRows[0]?.id;
    if (!slotId) throw new Error("expected a slot");
    await setup.participantClient.post(`/e/${setup.slug}/slots/${slotId}/join`);

    const response = await setup.client.post(
      `/e/${setup.slug}/takes/${secondTake.id}/delete`,
    );
    expect(response.status).toBe(303);
  });

  it("cascades delete to the take's slots and assignments", async () => {
    const setup = await setupEventWithSong();
    await createTake(setup.client, setup.slug, setup.songId);
    const db = createDb(env.DB);
    const takeRows = await db.select().from(take).where(eq(take.songId, setup.songId));
    const secondTake = takeRows.find((t) => t.id !== setup.takeId);
    if (!secondTake) throw new Error("expected a second take");

    await setup.client.post(`/e/${setup.slug}/takes/${secondTake.id}/delete`);
    const remainingSlots = await db
      .select()
      .from(slot)
      .where(eq(slot.takeId, secondTake.id));
    expect(remainingSlots).toHaveLength(0);
  });
});

describe("GET /e/:slug/takes/:id/slots/new", () => {
  it("redirects an unregistered viewer to /register", async () => {
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    const response = await client.get(
      `/e/${setup.slug}/takes/${setup.takeId}/slots/new`,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${setup.slug}/register`);
  });

  it("shows the form to a registered participant", async () => {
    const setup = await setupEventWithSong();
    const response = await setup.client.get(
      `/e/${setup.slug}/takes/${setup.takeId}/slots/new`,
    );
    expect(response.status).toBe(200);
  });
});

describe("POST /e/:slug/takes/:id/slots", () => {
  it("adds a new empty slot", async () => {
    const setup = await setupEventWithSong();
    const before = await findFirstSongSlotIds(setup.slug);
    const response = await createSlot(setup.client, setup.slug, setup.takeId, {
      instrument: "Cho",
    });
    expect(response.status).toBe(303);

    const after = await findFirstSongSlotIds(setup.slug);
    expect(after).toHaveLength(before.length + 1);
  });

  it("rejects once the per-take slot limit is reached", async () => {
    const setup = await setupEventWithSong();
    // Take1 は既定で5枠。上限20まで15個追加する。
    for (let i = 0; i < LIMITS.MAX_SLOTS_PER_TAKE - 5; i++) {
      const response = await createSlot(setup.client, setup.slug, setup.takeId, {
        instrument: `Extra${i}`,
      });
      expect(response.status).toBe(303);
    }
    const overLimit = await createSlot(setup.client, setup.slug, setup.takeId, {
      instrument: "OneTooMany",
    });
    expect(overLimit.status).toBe(400);

    const db = createDb(env.DB);
    const slotRows = await db.select().from(slot).where(eq(slot.takeId, setup.takeId));
    expect(slotRows).toHaveLength(LIMITS.MAX_SLOTS_PER_TAKE);
  });

  it("redirects an unregistered viewer to /register", async () => {
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    const response = await createSlot(client, setup.slug, setup.takeId);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${setup.slug}/register`);
  });

  it("is forbidden for a participant once the event is closed", async () => {
    const setup = await setupEventWithSongAndParticipant();
    await closeEvent(setup.slug);
    const response = await createSlot(
      setup.participantClient,
      setup.slug,
      setup.takeId,
    );
    expect(response.status).toBe(403);
  });
});

describe("POST /e/:slug/slots/:id/delete", () => {
  it("allows a participant to delete an empty slot", async () => {
    const setup = await setupEventWithSongAndParticipant();
    const slotIds = await findFirstSongSlotIds(setup.slug);
    const slotId = slotIds[0];
    if (!slotId) throw new Error("expected a slot");

    const response = await setup.participantClient.post(
      `/e/${setup.slug}/slots/${slotId}/delete`,
    );
    expect(response.status).toBe(303);

    const db = createDb(env.DB);
    const remaining = await db.select().from(slot).where(eq(slot.id, slotId));
    expect(remaining).toHaveLength(0);
  });

  it("forbids a participant from deleting a filled slot", async () => {
    const setup = await setupEventWithSongAndParticipant();
    const slotIds = await findFirstSongSlotIds(setup.slug);
    const slotId = slotIds[0];
    if (!slotId) throw new Error("expected a slot");
    await setup.participantClient.post(`/e/${setup.slug}/slots/${slotId}/join`);

    const response = await setup.participantClient.post(
      `/e/${setup.slug}/slots/${slotId}/delete`,
    );
    expect(response.status).toBe(403);

    const db = createDb(env.DB);
    const remaining = await db.select().from(slot).where(eq(slot.id, slotId));
    expect(remaining).toHaveLength(1);
  });

  it("allows the organizer to delete a filled slot", async () => {
    const setup = await setupEventWithSongAndParticipant();
    const slotIds = await findFirstSongSlotIds(setup.slug);
    const slotId = slotIds[0];
    if (!slotId) throw new Error("expected a slot");
    await setup.participantClient.post(`/e/${setup.slug}/slots/${slotId}/join`);

    const response = await setup.client.post(`/e/${setup.slug}/slots/${slotId}/delete`);
    expect(response.status).toBe(303);

    const db = createDb(env.DB);
    const remaining = await db.select().from(slot).where(eq(slot.id, slotId));
    expect(remaining).toHaveLength(0);
  });
});

describe("Take 削除ボタンの確認ダイアログ(data-confirm)", () => {
  it("空の Take なら「n回目を削除します」になる", async () => {
    const setup = await setupEventWithSong();
    await createTake(setup.client, setup.slug, setup.songId);

    const response = await setup.client.get(`/e/${setup.slug}/`);
    const html = await response.text();
    expect(html).toContain('data-confirm="2回目を削除します"');
  });

  it("埋まっている枠があれば担当者名を列挙する", async () => {
    const setup = await setupEventWithSong();
    await createTake(setup.client, setup.slug, setup.songId);
    const db = createDb(env.DB);
    const takeRows = await db.select().from(take).where(eq(take.songId, setup.songId));
    const secondTake = takeRows.find((t) => t.id !== setup.takeId);
    if (!secondTake) throw new Error("expected a second take");
    const slotRows = await db
      .select()
      .from(slot)
      .where(eq(slot.takeId, secondTake.id))
      .orderBy(asc(slot.sortOrder));
    const firstSlot = slotRows[0];
    if (!firstSlot) throw new Error("expected a slot");
    // createEvent の既定の主催者表示名は「主催者」。
    await setup.client.post(`/e/${setup.slug}/slots/${firstSlot.id}/join`);

    const response = await setup.client.get(`/e/${setup.slug}/`);
    const html = await response.text();
    expect(html).toContain(
      'data-confirm="2回目(Gt1: 主催者さん)を削除します。エントリーも消えます"',
    );
  });

  it("参加者名に < を含んでもエスケープされて壊れない", async () => {
    const setup = await setupEventWithSong();
    const other = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(other, setup.slug, { displayName: "<script>" });
    await createTake(setup.client, setup.slug, setup.songId);
    const db = createDb(env.DB);
    const takeRows = await db.select().from(take).where(eq(take.songId, setup.songId));
    const secondTake = takeRows.find((t) => t.id !== setup.takeId);
    if (!secondTake) throw new Error("expected a second take");
    const slotRows = await db
      .select()
      .from(slot)
      .where(eq(slot.takeId, secondTake.id))
      .orderBy(asc(slot.sortOrder));
    const firstSlot = slotRows[0];
    if (!firstSlot) throw new Error("expected a slot");
    await other.post(`/e/${setup.slug}/slots/${firstSlot.id}/join`);

    const response = await setup.client.get(`/e/${setup.slug}/`);
    const html = await response.text();
    expect(html).toContain(
      'data-confirm="2回目(Gt1: &lt;script&gt;さん)を削除します。エントリーも消えます"',
    );
    // エスケープされていない生の <script> タグとしては出現しない。
    expect(html).not.toContain("<script>さん");
  });
});

describe("クロスイベント: イベント B の song_id/take_id/slot_id をイベント A の cookie で操作する", () => {
  it("Take 追加(イベント B の song_id)は404になり、B の Take 数は変わらない", async () => {
    const eventA = await setupEventWithSong();
    const eventB = await setupEventWithSong();

    const response = await createTake(eventA.client, eventA.slug, eventB.songId);
    expect(response.status).toBe(404);

    const db = createDb(env.DB);
    const takeRows = await db.select().from(take).where(eq(take.songId, eventB.songId));
    expect(takeRows).toHaveLength(1);
  });

  it("Take 削除(イベント B の take_id)は404になり、B の Take は残る", async () => {
    const eventA = await setupEventWithSong();
    const eventB = await setupEventWithSong();

    const response = await eventA.client.post(
      `/e/${eventA.slug}/takes/${eventB.takeId}/delete`,
    );
    expect(response.status).toBe(404);

    const db = createDb(env.DB);
    const takeRows = await db.select().from(take).where(eq(take.id, eventB.takeId));
    expect(takeRows).toHaveLength(1);
  });

  it("Slot 追加フォーム(GET、イベント B の take_id)は404になる", async () => {
    const eventA = await setupEventWithSong();
    const eventB = await setupEventWithSong();

    const response = await eventA.client.get(
      `/e/${eventA.slug}/takes/${eventB.takeId}/slots/new`,
    );
    expect(response.status).toBe(404);
  });

  it("Slot 追加(POST、イベント B の take_id)は404になり、B の Slot 数は変わらない", async () => {
    const eventA = await setupEventWithSong();
    const eventB = await setupEventWithSong();
    const before = await findFirstSongSlotIds(eventB.slug);

    const response = await createSlot(eventA.client, eventA.slug, eventB.takeId);
    expect(response.status).toBe(404);

    const after = await findFirstSongSlotIds(eventB.slug);
    expect(after).toHaveLength(before.length);
  });

  it("Slot 削除(イベント B の slot_id)は404になり、B の Slot は残る", async () => {
    const eventA = await setupEventWithSong();
    const eventB = await setupEventWithSong();
    const slotIdsB = await findFirstSongSlotIds(eventB.slug);
    const slotBId = slotIdsB[0];
    if (!slotBId) throw new Error("expected a slot");

    const response = await eventA.client.post(
      `/e/${eventA.slug}/slots/${slotBId}/delete`,
    );
    expect(response.status).toBe(404);

    const db = createDb(env.DB);
    const remaining = await db.select().from(slot).where(eq(slot.id, slotBId));
    expect(remaining).toHaveLength(1);
  });
});
