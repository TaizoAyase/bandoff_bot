import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import { event as eventTable } from "../../src/db/schema";
import {
  closeEvent,
  createEvent,
  createSong,
  createTestClient,
  findFirstSongSlotIds,
  joinAsViewer,
  loginAsOrganizer,
  registerParticipant,
} from "../helpers";

describe("GET/POST /e/:slug/organizer/login", () => {
  it("sets the organizer flag on a correct password and redirects to /organizer", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await loginAsOrganizer(
      client,
      created.slug,
      created.organizerPassword,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${created.slug}/organizer`);

    const organizerPage = await client.get(`/e/${created.slug}/organizer`);
    expect(organizerPage.status).toBe(200);
    const html = await organizerPage.text();
    expect(html).toContain(created.joinCode);
    expect(html).toContain('data-copy-target="join-code-display"');
  });

  it("returns 401 on a wrong password", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await loginAsOrganizer(client, created.slug, "wrong-password");
    expect(response.status).toBe(401);
  });

  it("rate limits after 10 failures, even with the right password on the 11th try", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    for (let i = 0; i < 10; i++) {
      const response = await loginAsOrganizer(client, created.slug, "wrong-password");
      expect(response.status).toBe(401);
    }
    const limited = await loginAsOrganizer(
      client,
      created.slug,
      created.organizerPassword,
    );
    expect(limited.status).toBe(429);
  });
});

describe("POST /e/:slug/organizer/logout", () => {
  it("clears the organizer flag", async () => {
    const created = await createEvent();
    const response = await created.client.post(`/e/${created.slug}/organizer/logout`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${created.slug}/`);

    const organizerPage = await created.client.get(`/e/${created.slug}/organizer`);
    expect(organizerPage.status).toBe(403);
  });
});

describe("GET /e/:slug/organizer", () => {
  it("is forbidden without the organizer flag", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await client.get(`/e/${created.slug}/organizer`);
    expect(response.status).toBe(403);
    const html = await response.text();
    expect(html).toContain(`/e/${created.slug}/organizer/login`);
  });
});

describe("POST /e/:slug/organizer/event", () => {
  it("updates the event fields and status", async () => {
    const created = await createEvent({ title: "変更前タイトル" });
    const response = await created.client.post(`/e/${created.slug}/organizer/event`, {
      title: "変更後タイトル",
      region: "大阪",
      startsAt: "2026-10-01T20:00",
      place: "新しい場所",
      notes: "更新した備考",
      status: "closed",
    });
    expect(response.status).toBe(303);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(eventTable)
      .where(eq(eventTable.slug, created.slug));
    expect(rows[0]?.title).toBe("変更後タイトル");
    expect(rows[0]?.region).toBe("大阪");
    expect(rows[0]?.place).toBe("新しい場所");
    expect(rows[0]?.status).toBe("closed");
  });

  it("is forbidden without the organizer flag", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await client.post(`/e/${created.slug}/organizer/event`, {
      title: "改ざん",
      region: "東京",
      startsAt: "2026-09-05T19:00",
      place: "場所",
      notes: "",
      status: "upcoming",
    });
    expect(response.status).toBe(403);
  });
});

describe("closed バナー", () => {
  it("shows a closed banner on the song list once status=closed", async () => {
    const created = await createEvent();
    await closeEvent(created.slug);
    const response = await created.client.get(`/e/${created.slug}/`);
    const html = await response.text();
    expect(html).toContain("募集は締め切られています");
  });

  it("does not show the closed banner while upcoming", async () => {
    const created = await createEvent();
    const response = await created.client.get(`/e/${created.slug}/`);
    const html = await response.text();
    expect(html).not.toContain("募集は締め切られています");
  });
});

describe("organizer フラグのみで participant がない cookie(p=null, o=true)", () => {
  it("can open the organizer page and edit the event", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    await loginAsOrganizer(client, created.slug, created.organizerPassword);

    const organizerPage = await client.get(`/e/${created.slug}/organizer`);
    expect(organizerPage.status).toBe(200);

    const editResponse = await client.post(`/e/${created.slug}/organizer/event`, {
      title: "組織のみで編集",
      region: "東京",
      startsAt: "2026-09-05T19:00",
      place: "スタジオA",
      notes: "",
      status: "upcoming",
    });
    expect(editResponse.status).toBe(303);
  });

  it("is redirected to /register when trying to add a song", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    await loginAsOrganizer(client, created.slug, created.organizerPassword);

    const response = await createSong(client, created.slug, {
      title: "組織のみで曲登録",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${created.slug}/register`);
  });

  it("is redirected to /register?slot= when self-joining a slot with no proxy target", async () => {
    const created = await createEvent();
    const participant = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(participant, created.slug, { displayName: "参加者" });
    await createSong(participant, created.slug, { title: "自己エントリー不可対象" });
    const slotIds = await findFirstSongSlotIds(created.slug);
    const slotId = slotIds[0];
    if (!slotId) throw new Error("expected a slot");

    const organizerOnly = await joinAsViewer(created.slug, created.joinCode);
    await loginAsOrganizer(organizerOnly, created.slug, created.organizerPassword);
    const response = await organizerOnly.post(
      `/e/${created.slug}/slots/${slotId}/join`,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `/e/${created.slug}/register?slot=${encodeURIComponent(slotId)}`,
    );
  });

  it("can force-delete a filled slot without being a participant", async () => {
    const created = await createEvent();
    const participant = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(participant, created.slug, { displayName: "参加者" });
    await createSong(participant, created.slug, { title: "強制削除対象" });
    const slotIds = await findFirstSongSlotIds(created.slug);
    const slotId = slotIds[0];
    if (!slotId) throw new Error("expected a slot");
    await participant.post(`/e/${created.slug}/slots/${slotId}/join`);

    const organizerOnly = await joinAsViewer(created.slug, created.joinCode);
    await loginAsOrganizer(organizerOnly, created.slug, created.organizerPassword);
    const response = await organizerOnly.post(
      `/e/${created.slug}/slots/${slotId}/delete`,
    );
    expect(response.status).toBe(303);
  });

  it("can proxy-leave a participant's assignment without being a participant", async () => {
    const created = await createEvent();
    const participant = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(participant, created.slug, { displayName: "参加者" });
    await createSong(participant, created.slug, { title: "代理辞退対象" });
    const slotIds = await findFirstSongSlotIds(created.slug);
    const slotId = slotIds[0];
    if (!slotId) throw new Error("expected a slot");
    await participant.post(`/e/${created.slug}/slots/${slotId}/join`);

    const organizerOnly = await joinAsViewer(created.slug, created.joinCode);
    await loginAsOrganizer(organizerOnly, created.slug, created.organizerPassword);
    const response = await organizerOnly.post(
      `/e/${created.slug}/slots/${slotId}/leave`,
    );
    expect(response.status).toBe(303);
  });
});

describe("主催者による代理エントリー・代理辞退", () => {
  it("lets the organizer join a slot on behalf of another participant", async () => {
    const created = await createEvent();
    const participant = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(participant, created.slug, {
      displayName: "代理対象さん",
    });
    const songResponse = await createSong(created.client, created.slug, {
      title: "代理エントリー対象",
    });
    const slotIds = await findFirstSongSlotIds(created.slug);
    const slotId = slotIds[0];
    if (!slotId) throw new Error("expected a slot");

    // participant id を取得するため、曲一覧の data-participant を読む。
    const listResponse = await participant.get(`/e/${created.slug}/`);
    const html = await listResponse.text();
    const match = /data-participant="([^"]*)"/.exec(html);
    const participantId = match?.[1];
    if (!participantId || participantId === "0") {
      throw new Error("could not extract participant id");
    }

    const response = await created.client.post(
      `/e/${created.slug}/slots/${slotId}/join`,
      {
        participantId,
      },
    );
    expect(response.status).toBe(303);

    const confirmList = await created.client.get(`/e/${created.slug}/`);
    const confirmHtml = await confirmList.text();
    expect(confirmHtml).toContain("代理対象さん");
    expect(songResponse.status).toBe(303);
  });

  it("forbids a non-organizer participant from joining on behalf of someone else", async () => {
    const created = await createEvent();
    const participantA = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(participantA, created.slug, { displayName: "Aさん" });
    const participantB = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(participantB, created.slug, { displayName: "Bさん" });
    await createSong(participantA, created.slug, { title: "権限テスト曲" });
    const slotIds = await findFirstSongSlotIds(created.slug);
    const slotId = slotIds[0];
    if (!slotId) throw new Error("expected a slot");

    const listResponse = await participantB.get(`/e/${created.slug}/`);
    const html = await listResponse.text();
    const match = /data-participant="([^"]*)"/.exec(html);
    const participantBId = match?.[1];
    if (!participantBId || participantBId === "0") {
      throw new Error("could not extract participant id");
    }

    const response = await participantA.post(
      `/e/${created.slug}/slots/${slotId}/join`,
      {
        participantId: participantBId,
      },
    );
    expect(response.status).toBe(403);
  });

  it("shows a confirmation page for a proxy join into a 2nd slot in the same take, and preserves the target on resubmit", async () => {
    const created = await createEvent();
    const participant = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(participant, created.slug, { displayName: "代理対象B" });
    await createSong(created.client, created.slug, { title: "代理二重エントリー対象" });
    const [firstSlotId, secondSlotId] = await findFirstSongSlotIds(created.slug);
    if (!firstSlotId || !secondSlotId) throw new Error("expected at least 2 slots");

    const listResponse = await participant.get(`/e/${created.slug}/`);
    const html = await listResponse.text();
    const match = /data-participant="([^"]*)"/.exec(html);
    const participantId = match?.[1];
    if (!participantId || participantId === "0") {
      throw new Error("could not extract participant id");
    }

    // 主催者が代理対象Bを1つ目の枠に入れる。
    const firstJoin = await created.client.post(
      `/e/${created.slug}/slots/${firstSlotId}/join`,
      { participantId },
    );
    expect(firstJoin.status).toBe(303);

    // 同じ主催者が同じ代理対象Bをもう1つの枠にも入れようとすると確認ページになる。
    const confirmResponse = await created.client.post(
      `/e/${created.slug}/slots/${secondSlotId}/join`,
      { participantId },
    );
    expect(confirmResponse.status).toBe(200);
    const confirmHtml = await confirmResponse.text();
    expect(confirmHtml).toContain("それでもエントリーする");
    // 確認画面の再送信フォームには代理対象の participantId が
    // hidden field として保持されている(自分自身にすり替わらない)。
    expect(confirmHtml).toContain(`value="${participantId}"`);

    const proceedResponse = await created.client.post(
      `/e/${created.slug}/slots/${secondSlotId}/join`,
      { confirm: "1", participantId },
    );
    expect(proceedResponse.status).toBe(303);

    const finalList = await created.client.get(`/e/${created.slug}/`);
    const finalHtml = await finalList.text();
    // 代理対象B(主催者自身ではない)が両方の枠に入っている。
    expect((finalHtml.match(/代理対象B/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("cookie を全く持たないクライアントの主催者ルートアクセス", () => {
  it("returns 403 (requireOrganizer は viewer の有無を区別しない)", async () => {
    const created = await createEvent();
    const client = createTestClient();
    const response = await client.get(`/e/${created.slug}/organizer`);
    expect(response.status).toBe(403);
    const html = await response.text();
    expect(html).toContain(`/e/${created.slug}/organizer/login`);
  });
});
