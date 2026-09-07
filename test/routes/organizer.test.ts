import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import { event as eventTable } from "../../src/db/schema";
import { parseJstDateTimeLocal } from "../../src/domain/time";
import {
  closeEvent,
  createEvent,
  createSong,
  createTestClient,
  findFirstSongSlotIds,
  joinAsViewer,
  loginAsOrganizer,
  registerParticipant,
  setEventStartsAt,
} from "../helpers";

describe("GET/POST /e/:slug/organizer/login", () => {
  it("sets the organizer flag on a correct key and shows the login-done page", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await loginAsOrganizer(client, created.slug, created.organizerKey);
    expect(response.status).toBe(200);
    const doneHtml = await response.text();
    expect(doneHtml).toContain(`data-organizer-key="${created.organizerKey}"`);

    const organizerPage = await client.get(`/e/${created.slug}/organizer`);
    expect(organizerPage.status).toBe(200);
    const html = await organizerPage.text();
    expect(html).toContain(created.joinCode);
    expect(html).toContain('data-copy-target="join-code-display"');
  });

  it("accepts the key in lowercase with hyphens stripped", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const normalized = created.organizerKey.toLowerCase().replace(/-/g, "");
    const response = await loginAsOrganizer(client, created.slug, normalized);
    expect(response.status).toBe(200);

    const organizerPage = await client.get(`/e/${created.slug}/organizer`);
    expect(organizerPage.status).toBe(200);
  });

  it("returns 401 on a wrong key", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await loginAsOrganizer(client, created.slug, "WRNG-WRNG-WRNG");
    expect(response.status).toBe(401);
  });

  it("rate limits after 10 failures, even with the right key on the 11th try", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    for (let i = 0; i < 10; i++) {
      const response = await loginAsOrganizer(client, created.slug, "WRNG-WRNG-WRNG");
      expect(response.status).toBe(401);
    }
    const limited = await loginAsOrganizer(client, created.slug, created.organizerKey);
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
      startsDate: "2026-10-01",
      startsTime: "20:00",
      durationMinutes: "120",
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
    expect(rows[0]?.durationMinutes).toBe(120);
  });

  it("marks the saved duration as selected when the form is redisplayed", async () => {
    const created = await createEvent({ durationMinutes: "150" });
    const response = await created.client.get(`/e/${created.slug}/organizer`);
    const html = await response.text();

    // 保存済みの 150 分だけが selected になり、未設定と他の候補は外れる。
    expect(html).toContain('<option value="150" selected="">');
    expect(html).not.toContain('<option value="" selected="">');
    expect(html).not.toContain('<option value="180" selected="">');
  });

  it("marks 未設定 as selected when the event has no duration", async () => {
    const created = await createEvent();
    const response = await created.client.get(`/e/${created.slug}/organizer`);
    const html = await response.text();

    expect(html).toContain('<option value="" selected="">');
    expect(html).not.toContain('<option value="180" selected="">');
  });

  it("rejects a duration value outside the allow list (tampered select value)", async () => {
    const created = await createEvent({ title: "改ざん対象" });
    const response = await created.client.post(`/e/${created.slug}/organizer/event`, {
      title: "改ざん対象",
      region: "東京",
      startsDate: "2026-09-05",
      startsTime: "19:00",
      durationMinutes: "999",
      place: "場所",
      notes: "",
      status: "upcoming",
    });
    expect(response.status).toBe(400);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(eventTable)
      .where(eq(eventTable.slug, created.slug));
    expect(rows[0]?.durationMinutes).toBeNull();
  });

  it("is forbidden without the organizer flag", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await client.post(`/e/${created.slug}/organizer/event`, {
      title: "改ざん",
      region: "東京",
      startsDate: "2026-09-05",
      startsTime: "19:00",
      place: "場所",
      notes: "",
      status: "upcoming",
    });
    expect(response.status).toBe(403);
  });
});

describe("旧データ保護: 15分刻みでない starts_at の編集フォーム", () => {
  it("shows the actual value as an extra option instead of defaulting to 00:00", async () => {
    const created = await createEvent();
    // datetime-local 時代に作られた15分刻みでない値(例: 19:07)を
    // 直接 DB に書き込んで再現する。
    const legacyStartsAt = parseJstDateTimeLocal("2026-09-05T19:07");
    await setEventStartsAt(created.slug, legacyStartsAt);

    const response = await created.client.get(`/e/${created.slug}/organizer`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain(
      '<option value="19:07" selected="">19:07(15分刻みではありません)</option>',
    );
    expect(html).not.toContain('<option value="00:00" selected="">');
  });

  it("rejects saving without re-selecting the time (would otherwise silently become 00:00)", async () => {
    const created = await createEvent({ title: "旧データ編集対象" });
    const legacyStartsAt = parseJstDateTimeLocal("2026-09-05T19:07");
    await setEventStartsAt(created.slug, legacyStartsAt);

    const response = await created.client.post(`/e/${created.slug}/organizer/event`, {
      title: "旧データ編集対象",
      region: "東京",
      startsDate: "2026-09-05",
      startsTime: "19:07",
      place: "スタジオA",
      notes: "",
      status: "upcoming",
    });
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain("開始時刻を15分刻みで選び直してください");

    // エラーで再描画したときも旧値の option が残ること。ここが抜けると
    // 「1度エラーを出すと 00:00 に化ける」経路が復活し、主催者が2度目の
    // 送信で開始時刻を無警告に失う。
    expect(html).toContain(
      '<option value="19:07" selected="">19:07(15分刻みではありません)</option>',
    );
    expect(html).not.toContain('<option value="00:00" selected="">');

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(eventTable)
      .where(eq(eventTable.slug, created.slug));
    expect(rows[0]?.startsAt).toBe(legacyStartsAt);
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
    await loginAsOrganizer(client, created.slug, created.organizerKey);

    const organizerPage = await client.get(`/e/${created.slug}/organizer`);
    expect(organizerPage.status).toBe(200);

    const editResponse = await client.post(`/e/${created.slug}/organizer/event`, {
      title: "組織のみで編集",
      region: "東京",
      startsDate: "2026-09-05",
      startsTime: "19:00",
      place: "スタジオA",
      notes: "",
      status: "upcoming",
    });
    expect(editResponse.status).toBe(303);
  });

  it("is redirected to /register when trying to add a song", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    await loginAsOrganizer(client, created.slug, created.organizerKey);

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
    await loginAsOrganizer(organizerOnly, created.slug, created.organizerKey);
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
    await loginAsOrganizer(organizerOnly, created.slug, created.organizerKey);
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
    await loginAsOrganizer(organizerOnly, created.slug, created.organizerKey);
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
