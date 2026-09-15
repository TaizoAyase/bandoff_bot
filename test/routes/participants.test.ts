import { env } from "cloudflare:test";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import {
  assignment,
  event as eventTable,
  participant,
  slot,
  take,
} from "../../src/db/schema";
import {
  createEvent,
  createSong,
  createTestClient,
  extractSongId,
  findFirstSongSlotIds,
  joinAsViewer,
  registerParticipant,
} from "../helpers";

async function firstSlotId(slug: string): Promise<string> {
  const ids = await findFirstSongSlotIds(slug);
  const id = ids[0];
  if (!id) throw new Error("slot not found");
  return id;
}

/**
 * イベント(slug)内で表示名が完全一致する participant の id を取得する。
 * このテストファイルは複数の `it` が同じ D1 インスタンスを共有するため
 * (テストごとの分離はない)、`displayName` だけで検索すると別テストが
 * 作った同名の参加者を誤って拾いうる。必ず event 単位で絞り込む。
 */
async function findParticipantIdInEvent(
  slug: string,
  displayName: string,
): Promise<string> {
  const db = createDb(env.DB);
  const eventRows = await db.select().from(eventTable).where(eq(eventTable.slug, slug));
  const eventId = eventRows[0]?.id;
  if (!eventId) throw new Error(`event not found for slug ${slug}`);
  const rows = await db
    .select()
    .from(participant)
    .where(
      and(eq(participant.eventId, eventId), eq(participant.displayName, displayName)),
    );
  const row = rows[0];
  if (!row) throw new Error(`participant not found: ${displayName} in ${slug}`);
  return row.id;
}

/** 指定した曲(の Take1)の枠 id を sort_order 順にすべて取得する。 */
async function songSlotIds(songId: string): Promise<string[]> {
  const db = createDb(env.DB);
  const takeRows = await db.select().from(take).where(eq(take.songId, songId));
  const takeId = takeRows[0]?.id;
  if (!takeId) throw new Error(`songSlotIds: no take found for song ${songId}`);
  const slotRows = await db
    .select()
    .from(slot)
    .where(eq(slot.takeId, takeId))
    .orderBy(asc(slot.sortOrder));
  return slotRows.map((s) => s.id);
}

/**
 * 一括辞退テスト用に、2曲(曲A・曲B)を作り、参加者「山田」を
 * 曲Aの Gt1・曲Bの Ba にエントリーさせた状態を用意する。
 * 主催者(created.client)は別に曲Aの Ba にエントリーしておき、
 * 「他人のエントリーは残る」ことの確認に使う。
 */
async function setupForBulkLeave(displayName = "山田") {
  const created = await createEvent();
  const songAResponse = await createSong(created.client, created.slug, {
    title: "曲A",
  });
  const songAId = extractSongId(songAResponse);
  const songBResponse = await createSong(created.client, created.slug, {
    title: "曲B",
  });
  const songBId = extractSongId(songBResponse);

  const songASlots = await songSlotIds(songAId);
  const songBSlots = await songSlotIds(songBId);

  const client = await joinAsViewer(created.slug, created.joinCode);
  await registerParticipant(client, created.slug, { displayName });
  const participantId = await findParticipantIdInEvent(created.slug, displayName);

  // 山田: 曲Aの Gt1(index0)、曲Bの Ba(index2)。
  const gt1Slot = songASlots[0];
  const baSlot = songBSlots[2];
  if (!gt1Slot || !baSlot) throw new Error("expected slots");
  await client.post(`/e/${created.slug}/slots/${gt1Slot}/join`);
  await client.post(`/e/${created.slug}/slots/${baSlot}/join`);

  // 主催者自身も曲Aの Ba にエントリーしておく(他人のエントリーとして残るか確認する)。
  const organizerBaSlot = songASlots[2];
  if (!organizerBaSlot) throw new Error("expected slot");
  await created.client.post(`/e/${created.slug}/slots/${organizerBaSlot}/join`);

  return {
    ...created,
    participantClient: client,
    participantId,
    songAId,
    songBId,
    songASlots,
    songBSlots,
    organizerBaSlot,
  };
}

describe("GET /e/:slug/register", () => {
  it("redirects an already-registered participant to the song list", async () => {
    const created = await createEvent();
    // 主催者(created.client)は既に participant を持つ。
    const response = await created.client.get(`/e/${created.slug}/register`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${created.slug}/`);
  });
});

describe("POST /e/:slug/participants", () => {
  it("warns on an exact duplicate display name and requires confirm", async () => {
    const created = await createEvent({ organizerDisplayName: "山田" });
    const client = await joinAsViewer(created.slug, created.joinCode);

    const first = await registerParticipant(client, created.slug, {
      displayName: "山田",
    });
    expect(first.response.status).toBe(200);
    expect(first.html).toContain("既に使われています");

    const second = await registerParticipant(client, created.slug, {
      displayName: "山田",
      confirm: true,
    });
    expect(second.response.status).toBe(200);
    expect(second.html).toContain("data-token=");
  });

  it("completes the entry to the requested slot on registration (slot continuation)", async () => {
    const created = await createEvent();
    await createSong(created.client, created.slug, { title: "続きテスト曲" });
    const slotId = await firstSlotId(created.slug);

    const client = await joinAsViewer(created.slug, created.joinCode);
    // ブラウザの <form method="post"> 送信(Origin: null)を模した経路でも
    // 通ることを確認する。
    const result = await registerParticipant(client, created.slug, {
      displayName: "鈴木",
      slot: slotId,
      useBrowserForm: true,
    });
    expect(result.response.status).toBe(200);
    expect(result.html).toContain("に入りました");

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(assignment)
      .where(eq(assignment.slotId, slotId));
    expect(rows).toHaveLength(1);
  });

  it("shows 'taken' when the slot was filled by someone else during registration", async () => {
    const created = await createEvent();
    await createSong(created.client, created.slug, { title: "競合テスト曲" });
    const slotId = await firstSlotId(created.slug);

    // 主催者(既に participant)が先に入っておく。
    const joinResponse = await created.client.post(
      `/e/${created.slug}/slots/${slotId}/join`,
    );
    expect(joinResponse.status).toBe(303);

    const client = await joinAsViewer(created.slug, created.joinCode);
    const result = await registerParticipant(client, created.slug, {
      displayName: "鈴木",
      slot: slotId,
    });
    expect(result.response.status).toBe(200);
    expect(result.html).toContain("先を越されました");
  });

  it("rejects an empty display name", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await registerParticipant(client, created.slug, {
      displayName: "",
    });
    expect(response.response.status).toBe(400);
  });
});

async function closeEvent(slug: string): Promise<void> {
  const db = createDb(env.DB);
  await db
    .update(eventTable)
    .set({ status: "closed" })
    .where(eq(eventTable.slug, slug));
}

async function countParticipants(eventSlug: string): Promise<number> {
  const db = createDb(env.DB);
  const eventRows = await db
    .select()
    .from(eventTable)
    .where(eq(eventTable.slug, eventSlug));
  const eventId = eventRows[0]?.id;
  if (!eventId) throw new Error("event not found");
  const rows = await db
    .select()
    .from(participant)
    .where(eq(participant.eventId, eventId));
  return rows.length;
}

describe("closed イベントでは未登録 viewer の新規登録ができない", () => {
  it("GET /register は 403(登録画面自体を出さない)", async () => {
    const created = await createEvent();
    await closeEvent(created.slug);
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await client.get(`/e/${created.slug}/register`);
    expect(response.status).toBe(403);
  });

  it("slot なしの単純な新規登録は 403 になり participant が増えない", async () => {
    const created = await createEvent();
    const before = await countParticipants(created.slug);
    await closeEvent(created.slug);

    const client = await joinAsViewer(created.slug, created.joinCode);
    const result = await registerParticipant(client, created.slug, {
      displayName: "closedテスト太郎",
    });
    expect(result.response.status).toBe(403);
    expect(await countParticipants(created.slug)).toBe(before);
  });

  it("slot 指定つきの新規登録も 403 になり participant も assignment も増えない", async () => {
    const created = await createEvent();
    await createSong(created.client, created.slug, { title: "closedテスト曲" });
    const slotId = await firstSlotId(created.slug);
    const before = await countParticipants(created.slug);
    await closeEvent(created.slug);

    const client = await joinAsViewer(created.slug, created.joinCode);
    const result = await registerParticipant(client, created.slug, {
      displayName: "closedテスト花子",
      slot: slotId,
    });
    expect(result.response.status).toBe(403);
    expect(await countParticipants(created.slug)).toBe(before);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(assignment)
      .where(eq(assignment.slotId, slotId));
    expect(rows).toHaveLength(0);
  });

  it("organizer(登録済み)は closed でも requireOpenForParticipants に阻まれない", async () => {
    const created = await createEvent();
    await closeEvent(created.slug);
    // 主催者は既に participant を持つため 303 でホームへ戻るが、これは
    // requireOpenForParticipants の 403 とは異なる経路。ここで 403 に
    // ならないことが「主催者は closed でも通る」の確認になる。
    const response = await created.client.get(`/e/${created.slug}/register`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${created.slug}/`);
  });
});

describe("independent viewers do not leak sessions", () => {
  it("an unrelated viewer cannot see another event's data via /register", async () => {
    const created = await createEvent();
    const client = createTestClient();
    const response = await client.get(`/e/${created.slug}/register`);
    // cookie を持たない viewer は requireViewer で /join に誘導される。
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${created.slug}/join`);
  });
});

describe("GET /e/:slug/participants", () => {
  it("lists display names and instruments in created_at order", async () => {
    const created = await createEvent({ organizerDisplayName: "主催者太郎" });
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, {
      displayName: "後から参加",
      instruments: "Ba, Cho",
    });

    const response = await created.client.get(`/e/${created.slug}/participants`);
    expect(response.status).toBe(200);
    const html = await response.text();
    const organizerIndex = html.indexOf("主催者太郎");
    const laterIndex = html.indexOf("後から参加");
    expect(organizerIndex).toBeGreaterThan(-1);
    expect(laterIndex).toBeGreaterThan(organizerIndex);
    expect(html).toContain("Ba");
    expect(html).toContain("Cho");
  });

  it("is readable by an unregistered viewer", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await client.get(`/e/${created.slug}/participants`);
    expect(response.status).toBe(200);
  });
});

describe("参加者一覧: 一括辞退ボタンの表示(GET /e/:slug/participants)", () => {
  it("shows the leave-all form and its data-confirm to the organizer", async () => {
    const setup = await setupForBulkLeave();
    const response = await setup.client.get(`/e/${setup.slug}/participants`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(
      `action="/e/${setup.slug}/participants/${setup.participantId}/leave-all"`,
    );
    expect(html).toContain("全エントリーを辞退させる");
    expect(html).toContain(
      'data-confirm="山田さんの全エントリー(曲A: Gt1、曲B: Ba)を辞退させます"',
    );
  });

  it("does not show the leave-all form to a non-organizer viewer", async () => {
    const setup = await setupForBulkLeave();
    const response = await setup.participantClient.get(`/e/${setup.slug}/participants`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).not.toContain("全エントリーを辞退させる");
    expect(html).not.toContain("leave-all");
  });

  it("does not show the leave-all form for a participant with zero entries", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "枠なし太郎" });

    const response = await created.client.get(`/e/${created.slug}/participants`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("枠なし太郎");
    expect(html).not.toContain("全エントリーを辞退させる");
  });

  it("escapes a participant name containing < in the data-confirm attribute", async () => {
    const setup = await setupForBulkLeave("<script>");
    const response = await setup.client.get(`/e/${setup.slug}/participants`);
    const html = await response.text();
    expect(html).toContain(
      'data-confirm="&lt;script&gt;さんの全エントリー(曲A: Gt1、曲B: Ba)を辞退させます"',
    );
    expect(html).not.toContain("<script>さんの全エントリー");
  });
});

describe("参加者一覧: 「参加者から外す」ボタンの表示(GET /e/:slug/participants)", () => {
  it("shows the remove form and its data-confirm to the organizer", async () => {
    const setup = await setupForBulkLeave();
    const response = await setup.client.get(`/e/${setup.slug}/participants`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(
      `action="/e/${setup.slug}/participants/${setup.participantId}/remove"`,
    );
    expect(html).toContain("参加者から外す");
    expect(html).toContain(
      'data-confirm="山田さんを参加者から外します。全エントリー(曲A: Gt1、曲B: Ba)も辞退させます"',
    );
  });

  it("does not show the remove form to a non-organizer viewer", async () => {
    const setup = await setupForBulkLeave();
    const response = await setup.participantClient.get(`/e/${setup.slug}/participants`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).not.toContain("参加者から外す");
  });

  it("does not show the remove form on the organizer's own row", async () => {
    const setup = await setupForBulkLeave();
    const response = await setup.client.get(`/e/${setup.slug}/participants`);
    const html = await response.text();

    // 主催者自身の participant id を対象にした remove フォームは出ない
    // (主催者は1人しかいないイベント構成のため、id 単位の確認で十分)。
    const db = createDb(env.DB);
    const eventRows = await db
      .select()
      .from(eventTable)
      .where(eq(eventTable.slug, setup.slug));
    const organizerParticipantId = eventRows[0]?.organizerParticipantId;
    if (!organizerParticipantId) throw new Error("organizerParticipantId not set");
    expect(html).not.toContain(`/participants/${organizerParticipantId}/remove`);
  });

  it("shows the remove form even for a zero-entry participant (unlike leave-all)", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "枠なし次郎" });

    const response = await created.client.get(`/e/${created.slug}/participants`);
    const html = await response.text();
    // 一括辞退ボタンとは異なり、エントリー0件でも「参加者から外す」は出す。
    expect(html).toContain("枠なし次郎");
    expect(html).toContain('data-confirm="枠なし次郎さんを参加者から外します"');
  });

  it("escapes a participant name containing < in the remove data-confirm attribute", async () => {
    const setup = await setupForBulkLeave("<script>");
    const response = await setup.client.get(`/e/${setup.slug}/participants`);
    const html = await response.text();
    expect(html).toContain(
      'data-confirm="&lt;script&gt;さんを参加者から外します。全エントリー(曲A: Gt1、曲B: Ba)も辞退させます"',
    );
    expect(html).not.toContain("<script>さんを参加者から外します");
  });
});

describe("POST /e/:slug/participants/:id/leave-all", () => {
  it("removes only the target participant's assignments, leaving others intact", async () => {
    const setup = await setupForBulkLeave();

    const response = await setup.client.post(
      `/e/${setup.slug}/participants/${setup.participantId}/leave-all`,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `/e/${setup.slug}/participants?notice=left-all`,
    );

    const db = createDb(env.DB);
    const gt1Slot = setup.songASlots[0];
    const baSlotB = setup.songBSlots[2];
    if (!gt1Slot || !baSlotB) throw new Error("expected slots");

    const targetAssignmentsA = await db
      .select()
      .from(assignment)
      .where(eq(assignment.slotId, gt1Slot));
    expect(targetAssignmentsA).toHaveLength(0);
    const targetAssignmentsB = await db
      .select()
      .from(assignment)
      .where(eq(assignment.slotId, baSlotB));
    expect(targetAssignmentsB).toHaveLength(0);

    // 他人(主催者)のエントリーは残る。
    const organizerAssignments = await db
      .select()
      .from(assignment)
      .where(eq(assignment.slotId, setup.organizerBaSlot));
    expect(organizerAssignments).toHaveLength(1);

    // 対象者自身の登録・曲は消えない。
    const participantRows = await db
      .select()
      .from(participant)
      .where(eq(participant.id, setup.participantId));
    expect(participantRows).toHaveLength(1);
    const songRows = await db.select().from(take).where(eq(take.songId, setup.songAId));
    expect(songRows.length).toBeGreaterThan(0);
  });

  it("shows the 'left-all' notice after a successful bulk leave", async () => {
    const setup = await setupForBulkLeave();
    await setup.client.post(
      `/e/${setup.slug}/participants/${setup.participantId}/leave-all`,
    );
    const response = await setup.client.get(
      `/e/${setup.slug}/participants?notice=left-all`,
    );
    const html = await response.text();
    expect(html).toContain("辞退させました");
  });

  it("returns 403 for a non-organizer and deletes nothing", async () => {
    const setup = await setupForBulkLeave();
    const response = await setup.participantClient.post(
      `/e/${setup.slug}/participants/${setup.participantId}/leave-all`,
    );
    expect(response.status).toBe(403);

    const db = createDb(env.DB);
    const gt1Slot = setup.songASlots[0];
    if (!gt1Slot) throw new Error("expected slot");
    const rows = await db
      .select()
      .from(assignment)
      .where(eq(assignment.slotId, gt1Slot));
    expect(rows).toHaveLength(1);
  });

  it("returns 404 and deletes nothing for a participant id from another event", async () => {
    const setupA = await setupForBulkLeave();
    const setupB = await setupForBulkLeave();

    const response = await setupA.client.post(
      `/e/${setupA.slug}/participants/${setupB.participantId}/leave-all`,
    );
    expect(response.status).toBe(404);

    const db = createDb(env.DB);
    const bGt1Slot = setupB.songASlots[0];
    if (!bGt1Slot) throw new Error("expected slot");
    const rows = await db
      .select()
      .from(assignment)
      .where(eq(assignment.slotId, bGt1Slot));
    expect(rows).toHaveLength(1);
  });

  it("lets the organizer bulk-leave even once the event is closed", async () => {
    const setup = await setupForBulkLeave();
    await closeEvent(setup.slug);

    const response = await setup.client.post(
      `/e/${setup.slug}/participants/${setup.participantId}/leave-all`,
    );
    expect(response.status).toBe(303);

    const db = createDb(env.DB);
    const gt1Slot = setup.songASlots[0];
    if (!gt1Slot) throw new Error("expected slot");
    const rows = await db
      .select()
      .from(assignment)
      .where(eq(assignment.slotId, gt1Slot));
    expect(rows).toHaveLength(0);
  });

  it("does nothing (still 303) for a participant with zero entries", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "枠なし花子" });
    const participantId = await findParticipantIdInEvent(created.slug, "枠なし花子");

    const db = createDb(env.DB);
    const before = await db.select().from(assignment);
    const response = await created.client.post(
      `/e/${created.slug}/participants/${participantId}/leave-all`,
    );
    expect(response.status).toBe(303);
    const after = await db.select().from(assignment);
    expect(after).toHaveLength(before.length);
  });
});
