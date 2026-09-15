import { env } from "cloudflare:test";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import { joinSlot } from "../../src/db/queries/assignments";
import {
  assignment,
  event as eventTable,
  participant,
  slot,
  song,
  take,
} from "../../src/db/schema";
import {
  closeEvent,
  createEvent,
  createSong,
  createTestClient,
  extractSongId,
  joinAsViewer,
  loginAsOrganizer,
  registerParticipant,
} from "../helpers";

/**
 * イベント(slug)内で表示名が完全一致する participant の行を取得する。
 * このテストファイルは複数の `it` が同じ D1 インスタンスを共有するため、
 * 必ず event 単位で絞り込む(`test/routes/participants.test.ts` と同じ理由)。
 * 取りやめ・削除済み(left_at あり)の行も含めてそのまま返す。
 */
async function findParticipantRowsInEvent(slug: string, displayName: string) {
  const db = createDb(env.DB);
  const eventRows = await db.select().from(eventTable).where(eq(eventTable.slug, slug));
  const eventId = eventRows[0]?.id;
  if (!eventId) throw new Error(`event not found for slug ${slug}`);
  return db
    .select()
    .from(participant)
    .where(
      and(eq(participant.eventId, eventId), eq(participant.displayName, displayName)),
    );
}

async function findParticipantIdInEvent(
  slug: string,
  displayName: string,
): Promise<string> {
  const rows = await findParticipantRowsInEvent(slug, displayName);
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

/** `data-token`/`data-recovery-key` 属性から平文の値を取り出す。 */
function extractAttr(html: string, attr: string): string {
  const match = new RegExp(`${attr}="([^"]*)"`).exec(html);
  const value = match?.[1];
  if (!value) throw new Error(`could not find ${attr} in html`);
  return value;
}

/**
 * 曲A・曲Bを作り、参加者「山田」を曲Aの Gt1・曲Bの Ba にエントリーさせた
 * 状態を用意する(`participants.test.ts` の `setupForBulkLeave` と同じ形)。
 * 参加者登録時のレスポンスから token・recoveryKey も取っておく。
 */
async function setupWithdrawScenario(displayName = "山田") {
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
  const registered = await registerParticipant(client, created.slug, { displayName });
  const token = extractAttr(registered.html, "data-token");
  const recoveryKey = extractAttr(registered.html, "data-recovery-key");
  const participantId = await findParticipantIdInEvent(created.slug, displayName);

  const gt1Slot = songASlots[0];
  const baSlot = songBSlots[2];
  if (!gt1Slot || !baSlot) throw new Error("expected slots");
  await client.post(`/e/${created.slug}/slots/${gt1Slot}/join`);
  await client.post(`/e/${created.slug}/slots/${baSlot}/join`);

  return {
    ...created,
    participantClient: client,
    participantId,
    token,
    recoveryKey,
    songAId,
    songBId,
    songASlots,
    songBSlots,
  };
}

/** イベント全体の assignment のうち、指定した participant のものを数える。 */
async function countAssignmentsFor(eventId: string, participantId: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select({ id: assignment.id })
    .from(assignment)
    .innerJoin(slot, eq(slot.id, assignment.slotId))
    .innerJoin(take, eq(take.id, slot.takeId))
    .innerJoin(song, eq(song.id, take.songId))
    .where(and(eq(song.eventId, eventId), eq(assignment.participantId, participantId)));
  return rows.length;
}

async function eventIdOf(slug: string): Promise<string> {
  const db = createDb(env.DB);
  const rows = await db.select().from(eventTable).where(eq(eventTable.slug, slug));
  const id = rows[0]?.id;
  if (!id) throw new Error(`event not found for slug ${slug}`);
  return id;
}

describe("POST /e/:slug/settings/withdraw", () => {
  it("取りやめ完了ページを返し、left_at を設定して全エントリーを消す", async () => {
    const setup = await setupWithdrawScenario();
    const response = await setup.participantClient.post(
      `/e/${setup.slug}/settings/withdraw`,
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("参加を取りやめました");

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(participant)
      .where(eq(participant.id, setup.participantId));
    expect(rows[0]?.leftAt).not.toBeNull();

    const eventId = await eventIdOf(setup.slug);
    expect(await countAssignmentsFor(eventId, setup.participantId)).toBe(0);
  });

  it("曲・枠自体は消えず、登録者情報も DB に残ったままになる(表示からは除外)", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "作成者" });
    const participantId = await findParticipantIdInEvent(created.slug, "作成者");
    const songResponse = await createSong(client, created.slug, { title: "自作曲" });
    const songId = extractSongId(songResponse);

    const response = await client.post(`/e/${created.slug}/settings/withdraw`);
    expect(response.status).toBe(200);

    const db = createDb(env.DB);
    const songRows = await db.select().from(song).where(eq(song.id, songId));
    expect(songRows).toHaveLength(1);
    expect(songRows[0]?.proposedBy).toBe(participantId);
  });

  it("主催者本人は取りやめられない(403)", async () => {
    const created = await createEvent();
    const response = await created.client.post(`/e/${created.slug}/settings/withdraw`);
    expect(response.status).toBe(403);
  });

  it("未登録の viewer は /register に誘導される", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await client.post(`/e/${created.slug}/settings/withdraw`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${created.slug}/register`);
  });

  it("closed のイベントでは主催者以外は 403 になる", async () => {
    const setup = await setupWithdrawScenario();
    await closeEvent(setup.slug);
    const response = await setup.participantClient.post(
      `/e/${setup.slug}/settings/withdraw`,
    );
    expect(response.status).toBe(403);
  });

  it("取りやめ後は未登録として扱われる(/me・/settings)", async () => {
    const setup = await setupWithdrawScenario();
    await setup.participantClient.post(`/e/${setup.slug}/settings/withdraw`);

    const meResponse = await setup.participantClient.get(`/e/${setup.slug}/me`);
    expect(meResponse.status).toBe(200);
    const meHtml = await meResponse.text();
    expect(meHtml).toContain("参加登録すると");

    const settingsResponse = await setup.participantClient.get(
      `/e/${setup.slug}/settings`,
    );
    const settingsHtml = await settingsResponse.text();
    expect(settingsHtml).not.toContain('name="displayName"');
  });

  it("旧端末トークンでの /session/rebind は 401 になる", async () => {
    const setup = await setupWithdrawScenario();
    await setup.participantClient.post(`/e/${setup.slug}/settings/withdraw`);

    const anotherViewer = createTestClient();
    await anotherViewer.post(`/e/${setup.slug}/join`, { joinCode: setup.joinCode });
    const rebindResponse = await anotherViewer.post(
      `/e/${setup.slug}/session/rebind`,
      JSON.stringify({ token: setup.token }),
      { headers: { "content-type": "application/json" } },
    );
    expect(rebindResponse.status).toBe(401);
  });

  it("旧引き継ぎコードでの /recover は 401 になる", async () => {
    const setup = await setupWithdrawScenario();
    await setup.participantClient.post(`/e/${setup.slug}/settings/withdraw`);

    const anotherViewer = createTestClient();
    await anotherViewer.post(`/e/${setup.slug}/join`, { joinCode: setup.joinCode });
    const recoverResponse = await anotherViewer.post(`/e/${setup.slug}/recover`, {
      recoveryKey: setup.recoveryKey,
    });
    expect(recoverResponse.status).toBe(401);
  });

  it("参加者一覧・代理エントリーの参加者候補から除外される", async () => {
    const setup = await setupWithdrawScenario();
    await setup.participantClient.post(`/e/${setup.slug}/settings/withdraw`);

    const listResponse = await setup.client.get(`/e/${setup.slug}/participants`);
    const listHtml = await listResponse.text();
    expect(listHtml).not.toContain("山田");

    // 曲Aの空き枠(Gt2 等)には、organizer 視点で代理エントリー用の
    // <select> が出る。取りやめた参加者の id が選択肢に残っていないこと。
    const homeResponse = await setup.client.get(`/e/${setup.slug}/`);
    const homeHtml = await homeResponse.text();
    expect(homeHtml).not.toContain(`value="${setup.participantId}"`);
  });

  it("同じ表示名で再登録でき、重複警告が出ず、新しい participant が作られる", async () => {
    const setup = await setupWithdrawScenario();
    await setup.participantClient.post(`/e/${setup.slug}/settings/withdraw`);

    const newClient = await joinAsViewer(setup.slug, setup.joinCode);
    const result = await registerParticipant(newClient, setup.slug, {
      displayName: "山田",
    });
    expect(result.response.status).toBe(200);
    expect(result.html).not.toContain("既に使われています");
    expect(result.html).toContain("data-token=");

    const rows = await findParticipantRowsInEvent(setup.slug, "山田");
    expect(rows).toHaveLength(2);
    const newRow = rows.find((r) => r.id !== setup.participantId);
    expect(newRow?.leftAt).toBeNull();
  });

  it("主催者キーを共有された共同主催者は、自分自身を取りやめても /organizer に入れる", async () => {
    const setup = await setupWithdrawScenario();
    await loginAsOrganizer(setup.participantClient, setup.slug, setup.organizerKey);

    const response = await setup.participantClient.post(
      `/e/${setup.slug}/settings/withdraw`,
    );
    expect(response.status).toBe(200);

    const organizerPage = await setup.participantClient.get(
      `/e/${setup.slug}/organizer`,
    );
    expect(organizerPage.status).toBe(200);
  });
});

describe("POST /e/:slug/participants/:id/remove", () => {
  it("主催者が参加者を外すと 303 + notice=removed になり、left_at が設定される", async () => {
    const setup = await setupWithdrawScenario();
    const response = await setup.client.post(
      `/e/${setup.slug}/participants/${setup.participantId}/remove`,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `/e/${setup.slug}/participants?notice=removed`,
    );

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(participant)
      .where(eq(participant.id, setup.participantId));
    expect(rows[0]?.leftAt).not.toBeNull();

    const eventId = await eventIdOf(setup.slug);
    expect(await countAssignmentsFor(eventId, setup.participantId)).toBe(0);
  });

  it("notice=removed のメッセージが一覧に表示される", async () => {
    const setup = await setupWithdrawScenario();
    await setup.client.post(
      `/e/${setup.slug}/participants/${setup.participantId}/remove`,
    );
    const response = await setup.client.get(
      `/e/${setup.slug}/participants?notice=removed`,
    );
    const html = await response.text();
    expect(html).toContain("参加者から外しました");
  });

  it("非主催者は 403 で、何も変わらない", async () => {
    const setup = await setupWithdrawScenario();
    const response = await setup.participantClient.post(
      `/e/${setup.slug}/participants/${setup.participantId}/remove`,
    );
    expect(response.status).toBe(403);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(participant)
      .where(eq(participant.id, setup.participantId));
    expect(rows[0]?.leftAt).toBeNull();
  });

  it("主催者本人の Participant は外せない(403)", async () => {
    const created = await createEvent();
    const eventId = await eventIdOf(created.slug);
    const db = createDb(env.DB);
    const eventRows = await db
      .select()
      .from(eventTable)
      .where(eq(eventTable.id, eventId));
    const organizerParticipantId = eventRows[0]?.organizerParticipantId;
    if (!organizerParticipantId) throw new Error("organizerParticipantId not set");

    const response = await created.client.post(
      `/e/${created.slug}/participants/${organizerParticipantId}/remove`,
    );
    expect(response.status).toBe(403);
  });

  it("他イベントの participant id は 404 になる", async () => {
    const setupA = await setupWithdrawScenario();
    const setupB = await setupWithdrawScenario();

    const response = await setupA.client.post(
      `/e/${setupA.slug}/participants/${setupB.participantId}/remove`,
    );
    expect(response.status).toBe(404);
  });

  it("既に取りやめ・削除済みの id は 404 になる(二重削除できない)", async () => {
    const setup = await setupWithdrawScenario();
    const first = await setup.client.post(
      `/e/${setup.slug}/participants/${setup.participantId}/remove`,
    );
    expect(first.status).toBe(303);

    const second = await setup.client.post(
      `/e/${setup.slug}/participants/${setup.participantId}/remove`,
    );
    expect(second.status).toBe(404);
  });

  it("外された本人の次のリクエストは未登録として扱われる", async () => {
    const setup = await setupWithdrawScenario();
    await setup.client.post(
      `/e/${setup.slug}/participants/${setup.participantId}/remove`,
    );

    const meResponse = await setup.participantClient.get(`/e/${setup.slug}/me`);
    expect(meResponse.status).toBe(200);
    const meHtml = await meResponse.text();
    expect(meHtml).toContain("参加登録すると");
  });
});

describe("代理エントリー・一括辞退の対象が取りやめ済みのとき", () => {
  it("代理エントリーの対象 participantId が取りやめ済みなら 400 になる", async () => {
    const setup = await setupWithdrawScenario();
    await setup.participantClient.post(`/e/${setup.slug}/settings/withdraw`);

    // 曲Aの空き枠(Gt2)に、取りやめ済みの participantId を指定して代理エントリー。
    const emptySlot = setup.songASlots[1];
    if (!emptySlot) throw new Error("expected slot");
    const response = await setup.client.post(
      `/e/${setup.slug}/slots/${emptySlot}/join`,
      {
        participantId: setup.participantId,
      },
    );
    expect(response.status).toBe(400);
  });

  it("一括辞退の対象 id が取りやめ済みなら 404 になる", async () => {
    const setup = await setupWithdrawScenario();
    await setup.participantClient.post(`/e/${setup.slug}/settings/withdraw`);

    const response = await setup.client.post(
      `/e/${setup.slug}/participants/${setup.participantId}/leave-all`,
    );
    expect(response.status).toBe(404);
  });

  it("joinSlot に取りやめ済みの participantId を渡しても割り当てられない", async () => {
    const setup = await setupWithdrawScenario();
    await setup.participantClient.post(`/e/${setup.slug}/settings/withdraw`);

    const db = createDb(env.DB);
    const emptySlot = setup.songASlots[1];
    if (!emptySlot) throw new Error("expected slot");
    const now = Math.floor(Date.now() / 1000);
    const result = await joinSlot(db, {
      slotId: emptySlot,
      participantId: setup.participantId,
      now,
    });
    expect(result.kind).toBe("taken");

    const rows = await db
      .select()
      .from(assignment)
      .where(eq(assignment.slotId, emptySlot));
    expect(rows).toHaveLength(0);
  });
});
