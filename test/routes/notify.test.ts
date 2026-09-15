import { env } from "cloudflare:test";
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { createDb } from "../../src/db/client";
import { event as eventTable, participant, slot, take } from "../../src/db/schema";
import {
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

/**
 * `env.DISCORD_BOT_TOKEN` / `env.DISCORD_CHANNEL_ID` は `vitest.config.ts` の
 * bindings に含めていない(他の全テストが no-op のまま動くことを保証するため)。
 * このファイルだけ `beforeEach`/`afterEach` で値を出し入れする。
 */
const BOT_TOKEN = "test-bot-token";
const CHANNEL_ID = "123456789012345678";
const EXPECTED_URL = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`;

interface CapturedRequest {
  url: string;
  body: string;
  headers: Headers;
}

let originalBotToken: string | undefined;
let originalChannelId: string | undefined;
let capturedRequests: CapturedRequest[];
let fetchSpy: Mock<typeof fetch>;

beforeEach(() => {
  originalBotToken = env.DISCORD_BOT_TOKEN;
  originalChannelId = env.DISCORD_CHANNEL_ID;
  env.DISCORD_BOT_TOKEN = BOT_TOKEN;
  env.DISCORD_CHANNEL_ID = CHANNEL_ID;
  capturedRequests = [];
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    capturedRequests.push({
      url: typeof input === "string" ? input : input.toString(),
      body: String(init?.body ?? ""),
      headers: new Headers(init?.headers),
    });
    return new Response(null, { status: 204 });
  });
});

afterEach(() => {
  env.DISCORD_BOT_TOKEN = originalBotToken as string;
  env.DISCORD_CHANNEL_ID = originalChannelId as string;
  vi.restoreAllMocks();
});

function lastRequestBody(): {
  content: string;
  allowed_mentions: unknown;
  flags: unknown;
} {
  const request = capturedRequests.at(-1);
  if (!request) throw new Error("fetch was not called");
  return JSON.parse(request.body) as {
    content: string;
    allowed_mentions: unknown;
    flags: unknown;
  };
}

/** Discord 通知本文から `(n回目)` の n を取り出す。無ければ null。 */
function extractNotifiedOrdinal(content: string): number | null {
  const match = /\((\d+)回目\)/.exec(content);
  return match?.[1] ? Number(match[1]) : null;
}

/**
 * `/me` ページの HTML から `take-ordinal` の n を取り出す。無ければ null。
 * (`deriveMyAssignments`/`MyAssignmentItem` が生成する表記との突き合わせ用。)
 */
function extractMeOrdinal(html: string): number | null {
  const match = /class="take-ordinal">(\d+)回目</.exec(html);
  return match?.[1] ? Number(match[1]) : null;
}

/** 曲を1つ持つイベントを作り、その Take1 の枠 id を sort_order 順に返す。 */
async function setupEventWithSong() {
  const created = await createEvent({ title: "テストオフ会" });
  await createSong(created.client, created.slug, { title: "テスト曲" });
  const slotIds = await findFirstSongSlotIds(created.slug);
  // イベント作成(新規イベント)・曲追加の通知はここまでの `it` の対象外。
  // `request()` が各リクエストの `waitUntil` を待ち切ってから返るため、
  // ここに到達した時点でどちらの通知も送信済み(または no-op 判定済み)になっている。
  capturedRequests = [];
  fetchSpy.mockClear();
  return { ...created, slotIds };
}

/** 指定した曲(の Take1)の枠 id を sort_order 順にすべて取得する。 */
async function songSlotIds(songId: string): Promise<string[]> {
  return takeSlotIdsByOrder(songId, 0);
}

/**
 * 指定した曲の、sort_order 順で `takeIndex` 番目(0始まり)の Take の
 * 枠 id を sort_order 順にすべて取得する。複数 Take があるときの
 * 「n回目」表記のテストに使う。
 */
async function takeSlotIdsByOrder(
  songId: string,
  takeIndex: number,
): Promise<string[]> {
  const db = createDb(env.DB);
  const takeRows = await db
    .select()
    .from(take)
    .where(eq(take.songId, songId))
    .orderBy(asc(take.sortOrder));
  const targetTake = takeRows[takeIndex];
  if (!targetTake) {
    throw new Error(
      `takeSlotIdsByOrder: no take at index ${takeIndex} for song ${songId}`,
    );
  }
  const slotRows = await db
    .select()
    .from(slot)
    .where(eq(slot.takeId, targetTake.id))
    .orderBy(asc(slot.sortOrder));
  return slotRows.map((s) => s.id);
}

/** イベント(slug)内で表示名が完全一致する participant の id を取得する。 */
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

/**
 * 一括辞退テスト用に、3曲(曲A・曲B・曲C)を作り、参加者「山田」を
 * それぞれの Take1 の先頭の枠にエントリーさせた状態を用意する。
 * 曲を分けているのは、同じ Take 内の2つ目の枠は「確認」ページを挟む
 * (別のテスト対象)ため、それを避けるだけの目的。
 */
async function setupForBulkLeave() {
  const created = await createEvent({ title: "オフ会X" });
  const slotIds: string[] = [];
  for (const title of ["曲A", "曲B", "曲C"]) {
    const response = await createSong(created.client, created.slug, { title });
    const songId = extractSongId(response);
    const ids = await songSlotIds(songId);
    const firstSlot = ids[0];
    if (!firstSlot) throw new Error("expected a slot");
    slotIds.push(firstSlot);
  }

  const client = await joinAsViewer(created.slug, created.joinCode);
  await registerParticipant(client, created.slug, { displayName: "山田" });
  const participantId = await findParticipantIdInEvent(created.slug, "山田");

  for (const slotId of slotIds) {
    const response = await client.post(`/e/${created.slug}/slots/${slotId}/join`);
    expect(response.status).toBe(303);
  }

  // ここまでの join 通知は今回のアサーションの対象ではない。
  capturedRequests = [];
  fetchSpy.mockClear();

  return { ...created, participantClient: client, participantId, slotIds };
}

describe("Discord Bot 通知: エントリー(POST /e/:slug/slots/:id/join)", () => {
  it("エントリーすると Discord へ1回 POST され、表示名・曲名・楽器が本文に入る", async () => {
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(client, setup.slug, { displayName: "鈴木" });
    // 参加登録のみの通知(N7)はここまでの `it` の対象外。
    capturedRequests = [];
    fetchSpy.mockClear();

    const slotId = setup.slotIds[0];
    if (!slotId) throw new Error("expected a slot");
    const response = await client.post(`/e/${setup.slug}/slots/${slotId}/join`);
    expect(response.status).toBe(303);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(capturedRequests[0]?.url).toBe(EXPECTED_URL);
    const body = lastRequestBody();
    expect(body.content).toContain("テストオフ会");
    expect(body.content).toContain("鈴木");
    expect(body.content).toContain("テスト曲");
    // デフォルト枠構成(Gt, Gt, Ba, Dr, Vo)の先頭は Gt が2つあるため、
    // UI(/me・参加者一覧)と同じ採番済みラベル「Gt1」になっているはず。
    // 生の楽器名(「Gt」だけ)ならどちらのギターか分からない。
    expect(body.content).toContain("Gt1");
  });

  it("authorization ヘッダーが `Bot {token}` になり、URL にトークンが含まれない", async () => {
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(client, setup.slug, { displayName: "鈴木" });
    // 参加登録のみの通知(N7)はここまでの `it` の対象外。
    capturedRequests = [];
    fetchSpy.mockClear();

    const slotId = setup.slotIds[0];
    if (!slotId) throw new Error("expected a slot");
    await client.post(`/e/${setup.slug}/slots/${slotId}/join`);

    const request = capturedRequests.at(-1);
    if (!request) throw new Error("fetch was not called");
    expect(request.url).toBe(EXPECTED_URL);
    expect(request.headers.get("authorization")).toBe(`Bot ${BOT_TOKEN}`);
    // Bot Token は資格情報そのものなので、URL(チャンネル ID のみを含む)には
    // 現れてはいけない。Webhook 時代の「URL に秘密の slug を残さない」テスト
    // と同じ発想。
    expect(request.url).not.toContain(BOT_TOKEN);
  });

  it("body に allowed_mentions: { parse: [] } と flags: 4 が含まれる(メンション無効化・埋め込み抑止)", async () => {
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(client, setup.slug, { displayName: "@everyone" });
    // 参加登録のみの通知(N7)はここまでの `it` の対象外。
    capturedRequests = [];
    fetchSpy.mockClear();

    const slotId = setup.slotIds[0];
    if (!slotId) throw new Error("expected a slot");
    await client.post(`/e/${setup.slug}/slots/${slotId}/join`);

    const body = lastRequestBody();
    expect(body.allowed_mentions).toEqual({ parse: [] });
    // 表示名の @everyone 自体はそのまま本文に残ってよい。実際に発火しない
    // ことを保証するのは `allowed_mentions: { parse: [] }`(上のアサーション)
    // であって、本文側のエスケープ対象は Markdown 記号のみ。
    expect(body.content).toContain("@everyone");
    // 場所・曲名などに URL が含まれていてもリンクプレビューを展開させない
    // ため、SUPPRESS_EMBEDS(1 << 2 = 4)を常に立てる。
    expect(body.flags).toBe(4);
  });

  it("body にも URL にも slug が含まれない", async () => {
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(client, setup.slug, { displayName: "鈴木" });
    // 参加登録のみの通知(N7)はここまでの `it` の対象外。
    capturedRequests = [];
    fetchSpy.mockClear();

    const slotId = setup.slotIds[0];
    if (!slotId) throw new Error("expected a slot");
    await client.post(`/e/${setup.slug}/slots/${slotId}/join`);

    expect(capturedRequests[0]?.url).not.toContain(setup.slug);
    const body = lastRequestBody();
    expect(body.content).not.toContain(setup.slug);
  });
});

describe("Discord Bot 通知: 辞退(POST /e/:slug/slots/:id/leave)", () => {
  it("辞退でも Discord へ1回 POST される", async () => {
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(client, setup.slug, { displayName: "鈴木" });

    const slotId = setup.slotIds[0];
    if (!slotId) throw new Error("expected a slot");
    await client.post(`/e/${setup.slug}/slots/${slotId}/join`);
    // ここまでの join 通知はこのテストの対象外。
    capturedRequests = [];
    fetchSpy.mockClear();

    const response = await client.post(`/e/${setup.slug}/slots/${slotId}/leave`);
    expect(response.status).toBe(303);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = lastRequestBody();
    expect(body.content).toContain("辞退しました");
    // join のときと同じ採番済みラベルで辞退が通知されること。
    expect(body.content).toContain("Gt1");
  });
});

describe("Discord Bot 通知: Take が複数あるときの表記(/me 一覧と一致させる)", () => {
  it("2つ目の Take への参加は「(2回目)」が付き、1つ目には付かない", async () => {
    const created = await createEvent({ title: "テストオフ会" });
    const songResponse = await createSong(created.client, created.slug, {
      title: "複数回演奏",
    });
    const songId = extractSongId(songResponse);
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "鈴木" });

    const take1SlotIds = await takeSlotIdsByOrder(songId, 0);
    const take1Slot = take1SlotIds[0];
    if (!take1Slot) throw new Error("expected a slot");
    await client.post(`/e/${created.slug}/slots/${take1Slot}/join`);
    const take1Body = lastRequestBody();
    // Take が1件だけのときは deriveMyAssignments と同じく回数を出さない。
    expect(take1Body.content).not.toContain("回目");
    expect(take1Body.content).toContain("Gt1");

    await createTake(client, created.slug, songId);
    // Take 追加の通知(N5)はここまでの `it` の対象外。
    capturedRequests = [];
    fetchSpy.mockClear();

    const take2SlotIds = await takeSlotIdsByOrder(songId, 1);
    const take2Slot = take2SlotIds[0];
    if (!take2Slot) throw new Error("expected a slot");
    const response = await client.post(`/e/${created.slug}/slots/${take2Slot}/join`);
    expect(response.status).toBe(303);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const take2Body = lastRequestBody();
    expect(take2Body.content).toContain("(2回目)");
    expect(take2Body.content).toContain("Gt1");

    // /me ページ(deriveMyAssignments)の表記と食い違っていないことを確認する。
    const meResponse = await client.get(`/e/${created.slug}/me`);
    const meHtml = await meResponse.text();
    expect(meHtml).toContain("2回目");
  });

  it("枠0個の Take(末尾)があっても回数がずれない: Take2 を空にしてから Take1 に参加", async () => {
    const created = await createEvent({ title: "テストオフ会" });
    const songResponse = await createSong(created.client, created.slug, {
      title: "末尾が空Take",
    });
    const songId = extractSongId(songResponse);
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "鈴木" });

    // Take1 の枠構成を複製した Take2 を作り、その枠を全部削除して
    // 「枠が1つも無い Take」にする(`canDeleteSlot` は主催者なら
    // 埋まっていても削除できるが、ここではまだ誰も入っていない)。
    await createTake(client, created.slug, songId);
    const take2SlotIds = await takeSlotIdsByOrder(songId, 1);
    for (const slotId of take2SlotIds) {
      const deleteResponse = await created.client.post(
        `/e/${created.slug}/slots/${slotId}/delete`,
      );
      expect(deleteResponse.status).toBe(303);
    }

    const take1SlotIds = await takeSlotIdsByOrder(songId, 0);
    const take1Slot = take1SlotIds[0];
    if (!take1Slot) throw new Error("expected a slot");
    const response = await client.post(`/e/${created.slug}/slots/${take1Slot}/join`);
    expect(response.status).toBe(303);

    const body = lastRequestBody();
    const meResponse = await client.get(`/e/${created.slug}/me`);
    const meHtml = await meResponse.text();

    // Take は(枠0個の Take2 込みで)2件あるので、/me は「1回目」を出す
    // (deriveMyAssignments は空の Take も takes.length に数える)。
    // innerJoin のままだと Take2 が数から抜け落ち、通知には回数が出ない
    // (takeOrdinal: null)という不一致が起きる。
    expect(extractMeOrdinal(meHtml)).toBe(1);
    expect(extractNotifiedOrdinal(body.content)).toBe(extractMeOrdinal(meHtml));
  });

  it("枠0個の Take(先頭)があっても回数がずれない: Take1 を空にしてから Take3 に参加", async () => {
    const created = await createEvent({ title: "テストオフ会" });
    const songResponse = await createSong(created.client, created.slug, {
      title: "先頭が空Take",
    });
    const songId = extractSongId(songResponse);
    const client = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(client, created.slug, { displayName: "鈴木" });

    // Take1 がまだ枠を持っているうちに、Take1 を複製した Take2・Take3 を
    // 作っておく。
    await createTake(client, created.slug, songId);
    await createTake(client, created.slug, songId);

    // その後で Take1 の枠を全部削除し、「先頭が枠0個の Take」にする。
    const take1SlotIds = await takeSlotIdsByOrder(songId, 0);
    for (const slotId of take1SlotIds) {
      const deleteResponse = await created.client.post(
        `/e/${created.slug}/slots/${slotId}/delete`,
      );
      expect(deleteResponse.status).toBe(303);
    }

    const take3SlotIds = await takeSlotIdsByOrder(songId, 2);
    const take3Slot = take3SlotIds[0];
    if (!take3Slot) throw new Error("expected a slot");
    const response = await client.post(`/e/${created.slug}/slots/${take3Slot}/join`);
    expect(response.status).toBe(303);

    const body = lastRequestBody();
    const meResponse = await client.get(`/e/${created.slug}/me`);
    const meHtml = await meResponse.text();

    // Take は(枠0個の Take1 込みで)3件あるので、Take3 は「3回目」になる。
    // innerJoin のままだと takeOrder = [Take2, Take3] の2件しか見えず
    // 「2回目」になってしまい、/me の「3回目」とずれる。
    expect(extractMeOrdinal(meHtml)).toBe(3);
    expect(extractNotifiedOrdinal(body.content)).toBe(extractMeOrdinal(meHtml));
  });
});

describe("Discord Bot 通知: 主催者による一括辞退(POST /e/:slug/participants/:id/leave-all)", () => {
  it("3枠の一括辞退で POST は1回だけになり、本文に3件すべてが入る", async () => {
    const setup = await setupForBulkLeave();

    const response = await setup.client.post(
      `/e/${setup.slug}/participants/${setup.participantId}/leave-all`,
    );
    expect(response.status).toBe(303);

    // Discord のレート制限(おおよそ 5 リクエスト / 2 秒)に当たらないよう、
    // 1曲ずつではなくまとめて1通で送る(計画参照)。
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = lastRequestBody();
    expect(body.content).toContain("曲A");
    expect(body.content).toContain("曲B");
    expect(body.content).toContain("曲C");
    expect(body.content).toContain("山田");
  });
});

describe("Discord Bot 通知: イベント情報の編集(POST /e/:slug/organizer/event)", () => {
  it("変わった項目だけが差分行になる", async () => {
    const created = await createEvent({
      title: "変更前タイトル",
      region: "東京",
      place: "スタジオA",
    });
    // イベント作成(N1)の通知はこのテストの対象外。
    capturedRequests = [];
    fetchSpy.mockClear();

    const response = await created.client.post(`/e/${created.slug}/organizer/event`, {
      title: "変更後タイトル",
      region: "大阪",
      startsDate: "2026-09-05",
      startsTime: "19:00",
      durationMinutes: "",
      place: "スタジオA",
      notes: "",
      status: "upcoming",
    });
    expect(response.status).toBe(303);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = lastRequestBody();
    expect(body.content).toBe(
      [
        "〔変更後タイトル〕イベント情報が変更されました",
        "- イベント名: 変更前タイトル → 変更後タイトル",
        "- 地域: 東京 → 大阪",
      ].join("\n"),
    );
  });

  it("何も変わっていなければ通知は送られない", async () => {
    const created = await createEvent({
      title: "同じタイトル",
      region: "東京",
      place: "スタジオA",
    });
    capturedRequests = [];
    fetchSpy.mockClear();

    const response = await created.client.post(`/e/${created.slug}/organizer/event`, {
      title: "同じタイトル",
      region: "東京",
      startsDate: "2026-09-05",
      startsTime: "19:00",
      durationMinutes: "",
      place: "スタジオA",
      notes: "",
      status: "upcoming",
    });
    expect(response.status).toBe(303);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("募集状況の変更は主催者画面の選択肢に合わせたラベルになる", async () => {
    const created = await createEvent({ title: "テストオフ会" });
    capturedRequests = [];
    fetchSpy.mockClear();

    const response = await created.client.post(`/e/${created.slug}/organizer/event`, {
      title: "テストオフ会",
      region: "東京",
      startsDate: "2026-09-05",
      startsTime: "19:00",
      durationMinutes: "",
      place: "スタジオA",
      notes: "",
      status: "closed",
    });
    expect(response.status).toBe(303);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = lastRequestBody();
    expect(body.content).toContain("- 募集状況: 募集中 → 締切");
  });
});

describe("Discord Bot 通知: 曲の追加(POST /e/:slug/songs)", () => {
  it("本文にアーティスト・採番済みパートが入る", async () => {
    const created = await createEvent({ title: "テストオフ会" });
    // イベント作成(N1)の通知はこのテストの対象外。
    capturedRequests = [];
    fetchSpy.mockClear();

    const response = await createSong(created.client, created.slug, {
      title: "新曲",
      artist: "テストアーティスト",
      instruments: ["Gt", "Gt", "Ba"],
    });
    expect(response.status).toBe(303);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = lastRequestBody();
    expect(body.content).toBe(
      [
        "〔テストオフ会〕主催者さんが「新曲」を追加しました",
        "- アーティスト: テストアーティスト",
        "- パート: Gt1、Gt2、Ba",
      ].join("\n"),
    );
  });

  it("アーティストが空ならその行が本文に出ない", async () => {
    const created = await createEvent({ title: "テストオフ会" });
    capturedRequests = [];
    fetchSpy.mockClear();

    await createSong(created.client, created.slug, { title: "新曲", artist: "" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = lastRequestBody();
    expect(body.content).not.toContain("アーティスト");
  });
});

describe("Discord Bot 通知: 曲情報の編集(POST /e/:slug/songs/:id)", () => {
  it("変わった項目だけが差分行になる", async () => {
    const created = await createEvent({ title: "テストオフ会" });
    const songResponse = await createSong(created.client, created.slug, {
      title: "旧曲名",
      artist: "旧アーティスト",
      songKey: "C",
    });
    const songId = extractSongId(songResponse);
    // イベント作成(N1)・曲追加(N3)の通知はこのテストの対象外。
    capturedRequests = [];
    fetchSpy.mockClear();

    const editResponse = await created.client.post(
      `/e/${created.slug}/songs/${songId}`,
      {
        title: "新曲名",
        artist: "旧アーティスト",
        refUrl: "",
        songKey: "D",
        notes: "",
      },
    );
    expect(editResponse.status).toBe(303);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = lastRequestBody();
    expect(body.content).toBe(
      [
        "〔テストオフ会〕主催者さんが「旧曲名」の曲情報を変更しました",
        "- 曲名: 旧曲名 → 新曲名",
        "- キー: C → D",
      ].join("\n"),
    );
  });

  it("何も変わっていなければ通知は送られない", async () => {
    const created = await createEvent({ title: "テストオフ会" });
    const songResponse = await createSong(created.client, created.slug, {
      title: "曲",
    });
    const songId = extractSongId(songResponse);
    capturedRequests = [];
    fetchSpy.mockClear();

    const editResponse = await created.client.post(
      `/e/${created.slug}/songs/${songId}`,
      { title: "曲", artist: "", refUrl: "", songKey: "", notes: "" },
    );
    expect(editResponse.status).toBe(303);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Discord Bot 通知: 2回目以降の Take 追加(POST /e/:slug/songs/:id/takes)", () => {
  it("追加後の順位が本文に入る", async () => {
    const created = await createEvent({ title: "テストオフ会" });
    const songResponse = await createSong(created.client, created.slug, {
      title: "テスト曲",
    });
    const songId = extractSongId(songResponse);
    // イベント作成(N1)・曲追加(N3)の通知はこのテストの対象外。
    capturedRequests = [];
    fetchSpy.mockClear();

    const response = await createTake(created.client, created.slug, songId);
    expect(response.status).toBe(303);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = lastRequestBody();
    expect(body.content).toBe(
      "〔テストオフ会〕主催者さんが「テスト曲」の2回目を追加しました",
    );
  });
});

describe("Discord Bot 通知: 枠の追加(POST /e/:slug/takes/:id/slots)", () => {
  it("採番済みラベル・メモが本文に入る", async () => {
    const created = await createEvent({ title: "テストオフ会" });
    await createSong(created.client, created.slug, {
      title: "テスト曲",
      instruments: ["Gt"],
    });
    const { takeId } = await findFirstSongAndTakeId(created.slug);
    // イベント作成(N1)・曲追加(N3)の通知はこのテストの対象外。
    capturedRequests = [];
    fetchSpy.mockClear();

    const response = await createSlot(created.client, created.slug, takeId, {
      instrument: "Gt",
      note: "5弦ベースで",
    });
    expect(response.status).toBe(303);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = lastRequestBody();
    expect(body.content).toBe(
      [
        "〔テストオフ会〕主催者さんが「テスト曲」に Gt2 の枠を追加しました",
        "- メモ: 5弦ベースで",
      ].join("\n"),
    );
  });
});

describe("Discord Bot 通知: 参加者登録のみ(POST /e/:slug/participants)", () => {
  it("枠指定なしで登録すると「参加登録しました」になる", async () => {
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);

    const { response } = await registerParticipant(client, setup.slug, {
      displayName: "鈴木",
    });
    expect(response.status).toBe(200);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = lastRequestBody();
    expect(body.content).toBe("〔テストオフ会〕鈴木さんが参加登録しました");
  });

  it("存在しない枠 id を指定しても登録のみの本文になる", async () => {
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);

    await registerParticipant(client, setup.slug, {
      displayName: "鈴木",
      slot: "does-not-exist",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = lastRequestBody();
    expect(body.content).toBe("〔テストオフ会〕鈴木さんが参加登録しました");
  });

  it("先を越された場合も登録のみの本文になる(エントリー内容は出ない)", async () => {
    const setup = await setupEventWithSong();
    const slotId = setup.slotIds[0];
    if (!slotId) throw new Error("expected a slot");

    const firstClient = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(firstClient, setup.slug, {
      displayName: "先着",
      slot: slotId,
    });
    // 先着の登録+エントリー通知はこのテストの対象外。
    capturedRequests = [];
    fetchSpy.mockClear();

    const client = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(client, setup.slug, {
      displayName: "鈴木",
      slot: slotId,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = lastRequestBody();
    expect(body.content).toBe("〔テストオフ会〕鈴木さんが参加登録しました");
  });
});

describe("Discord Bot 通知: 登録+エントリー成功(POST /e/:slug/participants)", () => {
  it("既存の join 通知を置き換えて1通にまとまる(N8)", async () => {
    const setup = await setupEventWithSong();
    const slotId = setup.slotIds[0];
    if (!slotId) throw new Error("expected a slot");
    const client = await joinAsViewer(setup.slug, setup.joinCode);

    const { response } = await registerParticipant(client, setup.slug, {
      displayName: "鈴木",
      slot: slotId,
    });
    expect(response.status).toBe(200);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = lastRequestBody();
    expect(body.content).toBe(
      "〔テストオフ会〕鈴木さんが参加登録し、「テスト曲」の Gt1 に入りました",
    );
  });
});

describe("Discord Bot 通知: 未設定時は no-op", () => {
  it("DISCORD_BOT_TOKEN も DISCORD_CHANNEL_ID も未設定なら fetch は呼ばれない", async () => {
    env.DISCORD_BOT_TOKEN = "";
    env.DISCORD_CHANNEL_ID = "";
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(client, setup.slug, { displayName: "鈴木" });

    const slotId = setup.slotIds[0];
    if (!slotId) throw new Error("expected a slot");
    const response = await client.post(`/e/${setup.slug}/slots/${slotId}/join`);
    expect(response.status).toBe(303);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("DISCORD_BOT_TOKEN だけ設定されていても fetch は呼ばれない", async () => {
    env.DISCORD_CHANNEL_ID = "";
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(client, setup.slug, { displayName: "鈴木" });

    const slotId = setup.slotIds[0];
    if (!slotId) throw new Error("expected a slot");
    const response = await client.post(`/e/${setup.slug}/slots/${slotId}/join`);
    expect(response.status).toBe(303);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("DISCORD_CHANNEL_ID だけ設定されていても fetch は呼ばれない", async () => {
    env.DISCORD_BOT_TOKEN = "";
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(client, setup.slug, { displayName: "鈴木" });

    const slotId = setup.slotIds[0];
    if (!slotId) throw new Error("expected a slot");
    const response = await client.post(`/e/${setup.slug}/slots/${slotId}/join`);
    expect(response.status).toBe(303);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Discord Bot 通知: 不正なチャンネル ID なら送信しない", () => {
  it("チャンネル ID が数字列でなければ fetch は呼ばれない", async () => {
    // チャンネル ID は URL に直接埋め込まれるため、数字列以外(パス区切りを
    // 含む値など)だと想定外の Discord API エンドポイントを叩きかねない。
    env.DISCORD_CHANNEL_ID = "1/../../foo";
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(client, setup.slug, { displayName: "鈴木" });

    const slotId = setup.slotIds[0];
    if (!slotId) throw new Error("expected a slot");
    const response = await client.post(`/e/${setup.slug}/slots/${slotId}/join`);
    expect(response.status).toBe(303);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Discord Bot 通知: 送信の失敗を握りつぶす", () => {
  it("Discord が 500 を返してもエントリー操作は 303 のまま成功する", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(client, setup.slug, { displayName: "鈴木" });

    const slotId = setup.slotIds[0];
    if (!slotId) throw new Error("expected a slot");
    const response = await client.post(`/e/${setup.slug}/slots/${slotId}/join`);
    expect(response.status).toBe(303);
  });

  it("fetch が reject してもエントリー操作は 303 のまま成功する", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network error"));
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(client, setup.slug, { displayName: "鈴木" });

    const slotId = setup.slotIds[0];
    if (!slotId) throw new Error("expected a slot");
    const response = await client.post(`/e/${setup.slug}/slots/${slotId}/join`);
    expect(response.status).toBe(303);
  });
});
