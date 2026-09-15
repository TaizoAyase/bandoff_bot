import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import { event as eventTable, participant } from "../../src/db/schema";
import {
  closeEvent,
  consumeDiscordLink,
  createEvent,
  createTestClient,
  issueTestDiscordLink,
  joinAsViewer,
  registerParticipant,
  setEventStartsAtOffset,
} from "../helpers";

/**
 * `/e/:slug/discord` 配下(計画5章)のルートテスト。`createEvent()` の既定の
 * 開催日(`2026-09-05`)は実行時の「現在」(サンドボックスの実時刻)から見て
 * 既に24時間を超えて過去になっているため、リンクの消費・紐付けが成功する
 * はずのテストでは必ず `setEventStartsAtOffset()` で開催日時を「実行時の
 * 現在から見て24時間以内」に置き直す([[vitest-pool-workers-storage-per-file]]
 * と同じ理由で、このファイル内の各 `it` は同じ D1 を共有するため、検索は
 * すべて slug/eventId でスコープする)。
 */

async function eventIdOf(slug: string): Promise<string> {
  const db = createDb(env.DB);
  const rows = await db.select().from(eventTable).where(eq(eventTable.slug, slug));
  const id = rows[0]?.id;
  if (!id) throw new Error(`event not found for slug ${slug}`);
  return id;
}

async function findParticipantIdInEvent(
  slug: string,
  displayName: string,
): Promise<string> {
  const db = createDb(env.DB);
  const eventId = await eventIdOf(slug);
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

async function participantDiscordUserId(participantId: string): Promise<string | null> {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(participant)
    .where(eq(participant.id, participantId));
  return rows[0]?.discordUserId ?? null;
}

/**
 * `participant.discord_user_id` を直接書き込む(DB を直接操作)。
 * 「既に Discord アカウントと紐付いている participant」という前提条件を
 * 用意するためだけのテスト専用ヘルパ。本番の紐付けは常に `linkDiscordUser`
 * (条件付き UPDATE)経由であり、ここでは経由しない。
 */
async function linkParticipantDirectly(
  participantId: string,
  discordUserId: string,
): Promise<void> {
  const db = createDb(env.DB);
  await db
    .update(participant)
    .set({ discordUserId })
    .where(eq(participant.id, participantId));
}

function extractAttr(html: string, attr: string): string {
  const match = new RegExp(`${attr}="([^"]*)"`).exec(html);
  const value = match?.[1];
  if (!value) throw new Error(`could not find ${attr} in html`);
  return value;
}

describe("GET /e/:slug/discord", () => {
  it("shows the landing page even without a session cookie", async () => {
    const created = await createEvent();
    const fresh = createTestClient();
    const response = await fresh.get(`/e/${created.slug}/discord`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('data-page="discord-open"');
    expect(html).toContain(`data-slug="${created.slug}"`);
    expect(html).toContain("開いています");
  });

  it("404 for an unknown slug", async () => {
    const fresh = createTestClient();
    const response = await fresh.get("/e/does-not-exist/discord");
    expect(response.status).toBe(404);
  });
});

describe("POST /e/:slug/discord(トークンの消費)", () => {
  it("400 when the body is not valid JSON", async () => {
    const created = await createEvent();
    const fresh = createTestClient();
    const response = await fresh.post(`/e/${created.slug}/discord`, "not json", {
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(400);
  });

  it("400 when the body has no token", async () => {
    const created = await createEvent();
    const fresh = createTestClient();
    const response = await fresh.post(
      `/e/${created.slug}/discord`,
      JSON.stringify({}),
      {
        headers: { "content-type": "application/json" },
      },
    );
    expect(response.status).toBe(400);
  });

  it("401 for an unknown token", async () => {
    const created = await createEvent();
    const fresh = createTestClient();
    const response = await consumeDiscordLink(fresh, created.slug, "not-a-real-token");
    expect(response.status).toBe(401);
  });

  it("401 for an expired token", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const token = await issueTestDiscordLink(created.slug, { expiresInSeconds: -10 });
    const fresh = createTestClient();
    const response = await consumeDiscordLink(fresh, created.slug, token);
    expect(response.status).toBe(401);
  });

  it("401 for an already-used token", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const usedAt = Math.floor(Date.now() / 1000) - 10;
    const token = await issueTestDiscordLink(created.slug, { usedAt });
    const fresh = createTestClient();
    const response = await consumeDiscordLink(fresh, created.slug, token);
    expect(response.status).toBe(401);
  });

  it("401 on a second consumption of the same token", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000015",
    });
    const fresh = createTestClient();
    const first = await consumeDiscordLink(fresh, created.slug, token);
    expect(first.status).toBe(200);
    const second = await consumeDiscordLink(fresh, created.slug, token);
    expect(second.status).toBe(401);
  });

  it("401 when the linked event differs from the URL's slug", async () => {
    const eventA = await createEvent();
    const eventB = await createEvent();
    await setEventStartsAtOffset(eventA.slug, -3600);
    await setEventStartsAtOffset(eventB.slug, -3600);
    const token = await issueTestDiscordLink(eventA.slug, {
      discordUserId: "700000000000000016",
    });
    const fresh = createTestClient();
    const response = await consumeDiscordLink(fresh, eventB.slug, token);
    expect(response.status).toBe(401);
  });

  it("401 when discordEnabled was turned off after the link was issued", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000017",
    });
    const db = createDb(env.DB);
    await db
      .update(eventTable)
      .set({ discordEnabled: false })
      .where(eq(eventTable.slug, created.slug));
    const fresh = createTestClient();
    const response = await consumeDiscordLink(fresh, created.slug, token);
    expect(response.status).toBe(401);
  });

  it("401 when the event passed the 24h window after the link was issued", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000018",
    });
    await setEventStartsAtOffset(created.slug, -90000);
    const fresh = createTestClient();
    const response = await consumeDiscordLink(fresh, created.slug, token);
    expect(response.status).toBe(401);
  });

  it("closed のイベントでもリンクを消費できる(候補条件は closed も含む)", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    await closeEvent(created.slug);
    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000019",
    });
    const fresh = createTestClient();
    const response = await consumeDiscordLink(fresh, created.slug, token);
    expect(response.status).toBe(200);
  });
});

describe("紐付け A/B/C(計画5-3)", () => {
  it("A: 既に紐付いた参加中の participant がいれば、その participant としてログインする", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const viewer = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(viewer, created.slug, { displayName: "参加者A" });
    const participantId = await findParticipantIdInEvent(created.slug, "参加者A");
    await linkParticipantDirectly(participantId, "700000000000000030");

    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000030",
    });
    const fresh = createTestClient();
    const response = await consumeDiscordLink(fresh, created.slug, token);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ redirect: `/e/${created.slug}/` });

    const home = await fresh.get(`/e/${created.slug}/`);
    const html = await home.text();
    expect(html).toContain(`data-participant="${participantId}"`);
    // A では紐付け待ちを付けないので、確認バナーは出ない。
    expect(html).not.toContain("この Discord アカウントを");
  });

  it("A: 主催者本人の participant に紐付いていても、o は付与されない(/organizer は 403)", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const eventId = await eventIdOf(created.slug);
    const db = createDb(env.DB);
    const eventRows = await db
      .select()
      .from(eventTable)
      .where(eq(eventTable.id, eventId));
    const organizerParticipantId = eventRows[0]?.organizerParticipantId;
    if (!organizerParticipantId) throw new Error("organizerParticipantId not set");
    await linkParticipantDirectly(organizerParticipantId, "700000000000000031");

    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000031",
    });
    const fresh = createTestClient();
    const response = await consumeDiscordLink(fresh, created.slug, token);
    expect(response.status).toBe(200);

    const organizerPage = await fresh.get(`/e/${created.slug}/organizer`);
    expect(organizerPage.status).toBe(403);
  });

  it("B: 今の participant が未紐付けなら、その participant のまま紐付け待ちを付ける", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const viewer = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(viewer, created.slug, { displayName: "参加者B" });
    const participantId = await findParticipantIdInEvent(created.slug, "参加者B");

    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000032",
      displayNameHint: "ニックB",
    });
    const response = await consumeDiscordLink(viewer, created.slug, token);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ redirect: `/e/${created.slug}/` });

    expect(await participantDiscordUserId(participantId)).toBeNull();

    const home = await viewer.get(`/e/${created.slug}/`);
    const html = await home.text();
    expect(html).toContain(`data-participant="${participantId}"`);
    expect(html).toContain("この Discord アカウントを");
    // 表示名は participant のもの(Discord 側のニックネームではない)。
    expect(html).toContain("「参加者B」");
    expect(html).not.toContain("ニックB");
  });

  it("C: 未ログイン(cookie なし)なら participant を持たず紐付け待ちを付ける", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000033",
    });
    const fresh = createTestClient();
    const response = await consumeDiscordLink(fresh, created.slug, token);
    expect(response.status).toBe(200);

    const home = await fresh.get(`/e/${created.slug}/`);
    const html = await home.text();
    expect(html).toContain('data-participant="0"');
    expect(html).toContain("Discord から開きました");
  });

  it("C: 今の participant が別の Discord ID に紐付き済みなら、participant を外して紐付け待ちを付ける", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const viewer = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(viewer, created.slug, { displayName: "既紐付け済み" });
    const participantId = await findParticipantIdInEvent(created.slug, "既紐付け済み");
    await linkParticipantDirectly(participantId, "700000000000000034");

    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000035",
    });
    const response = await consumeDiscordLink(viewer, created.slug, token);
    expect(response.status).toBe(200);

    const home = await viewer.get(`/e/${created.slug}/`);
    const html = await home.text();
    expect(html).toContain('data-participant="0"');
    expect(html).toContain("Discord から開きました");
    // 元の紐付けは上書きされていない。
    expect(await participantDiscordUserId(participantId)).toBe("700000000000000034");
  });

  it("紐付け待ちが無ければ、どちらのバナーも出ない", async () => {
    const created = await createEvent();
    const viewer = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(viewer, created.slug, { displayName: "普通の参加者" });
    const home = await viewer.get(`/e/${created.slug}/`);
    const html = await home.text();
    expect(html).not.toContain("この Discord アカウントを");
    expect(html).not.toContain("Discord から開きました");
  });
});

describe("POST /e/:slug/discord/link・dismiss(確認バナーからの操作)", () => {
  it("[紐付ける] → discord_user_id を設定し、次回の open が A になる", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const viewer = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(viewer, created.slug, { displayName: "山田" });
    const participantId = await findParticipantIdInEvent(created.slug, "山田");

    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000040",
    });
    await consumeDiscordLink(viewer, created.slug, token);

    const linkResponse = await viewer.post(`/e/${created.slug}/discord/link`);
    expect(linkResponse.status).toBe(303);
    expect(linkResponse.headers.get("location")).toBe(
      `/e/${created.slug}/?notice=discord-linked`,
    );
    expect(await participantDiscordUserId(participantId)).toBe("700000000000000040");

    const notice = await viewer.get(`/e/${created.slug}/?notice=discord-linked`);
    expect(await notice.text()).toContain("Discord アカウントと紐付けました");

    // バナー自体はもう出ない(紐付け待ちが消えた)。
    const home = await viewer.get(`/e/${created.slug}/`);
    expect(await home.text()).not.toContain("この Discord アカウントを");

    // 次回の open は A(そのまま本人としてログイン)になる。
    const token2 = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000040",
    });
    const fresh = createTestClient();
    await consumeDiscordLink(fresh, created.slug, token2);
    const freshHome = await fresh.get(`/e/${created.slug}/`);
    expect(await freshHome.text()).toContain(`data-participant="${participantId}"`);
  });

  it("[今はしない] → 紐付け待ちが消え、discord_user_id は設定されない", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const viewer = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(viewer, created.slug, { displayName: "鈴木" });
    const participantId = await findParticipantIdInEvent(created.slug, "鈴木");

    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000041",
    });
    await consumeDiscordLink(viewer, created.slug, token);

    const dismissResponse = await viewer.post(`/e/${created.slug}/discord/dismiss`);
    expect(dismissResponse.status).toBe(303);
    expect(dismissResponse.headers.get("location")).toBe(`/e/${created.slug}/`);

    expect(await participantDiscordUserId(participantId)).toBeNull();
    const home = await viewer.get(`/e/${created.slug}/`);
    expect(await home.text()).not.toContain("この Discord アカウントを");
  });

  it("他の participant に紐付き済み → conflict の notice を出し、上書きしない", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const later = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(later, created.slug, { displayName: "後発" });
    const laterId = await findParticipantIdInEvent(created.slug, "後発");

    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000042",
    });
    // まだ誰も紐付いていない時点で消費する(B: 紐付け待ちが付く)。
    await consumeDiscordLink(later, created.slug, token);

    // レース: バナー表示後・[紐付ける]クリック前に、別の participant が
    // 同じ Discord ID に(直接)紐付いてしまう。
    const earlier = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(earlier, created.slug, { displayName: "先住民" });
    const earlierId = await findParticipantIdInEvent(created.slug, "先住民");
    await linkParticipantDirectly(earlierId, "700000000000000042");

    const linkResponse = await later.post(`/e/${created.slug}/discord/link`);
    expect(linkResponse.status).toBe(303);
    expect(linkResponse.headers.get("location")).toBe(
      `/e/${created.slug}/?notice=discord-link-conflict`,
    );
    expect(await participantDiscordUserId(laterId)).toBeNull();
    expect(await participantDiscordUserId(earlierId)).toBe("700000000000000042");

    const notice = await later.get(`/e/${created.slug}/?notice=discord-link-conflict`);
    expect(await notice.text()).toContain(
      "この Discord アカウントは別の参加者に紐付いています",
    );
  });

  it("紐付け待ちが無ければ何もせず曲一覧へ戻る", async () => {
    const created = await createEvent();
    const viewer = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(viewer, created.slug, { displayName: "山田" });
    const linkResponse = await viewer.post(`/e/${created.slug}/discord/link`);
    expect(linkResponse.status).toBe(303);
    expect(linkResponse.headers.get("location")).toBe(`/e/${created.slug}/`);
  });

  it("未登録の viewer が /discord/link を叩くと /register に誘導される", async () => {
    const created = await createEvent();
    const viewer = await joinAsViewer(created.slug, created.joinCode);
    const response = await viewer.post(`/e/${created.slug}/discord/link`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${created.slug}/register`);
  });
});

describe("rebind 後の紐付け待ち(計画5-1)", () => {
  it("rebind 後も紐付け待ちが残り、確認バナーが出る", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const original = await joinAsViewer(created.slug, created.joinCode);
    const registered = await registerParticipant(original, created.slug, {
      displayName: "山田",
    });
    const token = extractAttr(registered.html, "data-token");
    const participantId = await findParticipantIdInEvent(created.slug, "山田");

    const linkToken = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000050",
      displayNameHint: "リバインド",
    });
    const newBrowser = createTestClient();
    // まだ cookie を持たないので C(participant なし)になる。
    await consumeDiscordLink(newBrowser, created.slug, linkToken);

    const rebindResponse = await newBrowser.post(
      `/e/${created.slug}/session/rebind`,
      JSON.stringify({ token }),
      { headers: { "content-type": "application/json" } },
    );
    expect(rebindResponse.status).toBe(204);

    const home = await newBrowser.get(`/e/${created.slug}/`);
    const html = await home.text();
    expect(html).toContain(`data-participant="${participantId}"`);
    expect(html).toContain("この Discord アカウントを");
    expect(html).toContain("「山田」");
  });
});

describe("登録時の自動紐付け(計画5-4)", () => {
  it("GET /register: 表示名の初期値が Discord のヒントになり、案内が出る", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000060",
      displayNameHint: "にっく",
    });
    const fresh = createTestClient();
    await consumeDiscordLink(fresh, created.slug, token);

    const response = await fresh.get(`/e/${created.slug}/register`);
    const html = await response.text();
    expect(html).toContain('value="にっく"');
    expect(html).toContain("Discord アカウントと紐付けて登録します");
    expect(html).toContain("引き継ぎコードで入る");
  });

  it("紐付け待ちがあれば、登録した participant に自動で紐付ける", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000061",
      displayNameHint: "にっく",
    });
    const fresh = createTestClient();
    await consumeDiscordLink(fresh, created.slug, token);

    const result = await registerParticipant(fresh, created.slug, {
      displayName: "にっく",
    });
    expect(result.response.status).toBe(200);
    const participantId = await findParticipantIdInEvent(created.slug, "にっく");
    expect(await participantDiscordUserId(participantId)).toBe("700000000000000061");
  });

  it("既に他の participant に紐付き済みなら、紐付けずに登録だけ成功させる", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000062",
    });
    const fresh = createTestClient();
    // まだ誰も紐付いていない時点で消費する(C: 紐付け待ちが付く)。
    await consumeDiscordLink(fresh, created.slug, token);

    // レース: 案内バナー表示後・登録前に、別の participant が同じ
    // Discord ID に(直接)紐付いてしまう。
    const earlier = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(earlier, created.slug, { displayName: "先住民2" });
    const earlierId = await findParticipantIdInEvent(created.slug, "先住民2");
    await linkParticipantDirectly(earlierId, "700000000000000062");

    const result = await registerParticipant(fresh, created.slug, {
      displayName: "新参者2",
    });
    expect(result.response.status).toBe(200);
    const newParticipantId = await findParticipantIdInEvent(created.slug, "新参者2");
    expect(await participantDiscordUserId(newParticipantId)).toBeNull();
    expect(await participantDiscordUserId(earlierId)).toBe("700000000000000062");
  });
});

describe("引き継ぎ(recover)時の自動紐付け(計画5-4)", () => {
  it("紐付け待ちがあれば、復帰した participant に自動で紐付ける", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const original = await joinAsViewer(created.slug, created.joinCode);
    const registered = await registerParticipant(original, created.slug, {
      displayName: "山田2",
    });
    const recoveryKey = extractAttr(registered.html, "data-recovery-key");
    const participantId = await findParticipantIdInEvent(created.slug, "山田2");

    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000070",
    });
    const withPending = createTestClient();
    await consumeDiscordLink(withPending, created.slug, token);

    const recoverResponse = await withPending.post(`/e/${created.slug}/recover`, {
      recoveryKey,
    });
    expect(recoverResponse.status).toBe(200);
    expect(await participantDiscordUserId(participantId)).toBe("700000000000000070");
  });

  it("別の Discord ID に紐付き済みなら上書きしない", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const original = await joinAsViewer(created.slug, created.joinCode);
    const registered = await registerParticipant(original, created.slug, {
      displayName: "鈴木2",
    });
    const recoveryKey = extractAttr(registered.html, "data-recovery-key");
    const participantId = await findParticipantIdInEvent(created.slug, "鈴木2");
    await linkParticipantDirectly(participantId, "700000000000000071");

    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000072",
    });
    const withPending = createTestClient();
    await consumeDiscordLink(withPending, created.slug, token);

    const recoverResponse = await withPending.post(`/e/${created.slug}/recover`, {
      recoveryKey,
    });
    expect(recoverResponse.status).toBe(200);
    expect(await participantDiscordUserId(participantId)).toBe("700000000000000071");
  });
});

describe("部分ユニークインデックス(計画3-3)", () => {
  it("取りやめた participant と同じ Discord ID で、別の participant に紐付けできる", async () => {
    const created = await createEvent();
    await setEventStartsAtOffset(created.slug, -3600);
    const leaving = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(leaving, created.slug, { displayName: "退会予定" });
    const leavingId = await findParticipantIdInEvent(created.slug, "退会予定");
    await linkParticipantDirectly(leavingId, "700000000000000080");

    const withdrawResponse = await leaving.post(`/e/${created.slug}/settings/withdraw`);
    expect(withdrawResponse.status).toBe(200);

    const token = await issueTestDiscordLink(created.slug, {
      discordUserId: "700000000000000080",
    });
    const fresh = createTestClient();
    await consumeDiscordLink(fresh, created.slug, token);
    const result = await registerParticipant(fresh, created.slug, {
      displayName: "新しい人",
    });
    expect(result.response.status).toBe(200);
    const newId = await findParticipantIdInEvent(created.slug, "新しい人");
    expect(await participantDiscordUserId(newId)).toBe("700000000000000080");
  });
});

describe("解除(設定画面、計画5-6)", () => {
  it("紐付け済みなら解除ボタンが出て、POST で解除できる", async () => {
    const created = await createEvent();
    const viewer = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(viewer, created.slug, { displayName: "山田3" });
    const participantId = await findParticipantIdInEvent(created.slug, "山田3");
    await linkParticipantDirectly(participantId, "700000000000000090");

    const settingsHtml = await (await viewer.get(`/e/${created.slug}/settings`)).text();
    expect(settingsHtml).toContain("Discord アカウントと紐付いています");
    expect(settingsHtml).toContain("紐付けを解除する");

    const unlinkResponse = await viewer.post(
      `/e/${created.slug}/settings/discord/unlink`,
    );
    expect(unlinkResponse.status).toBe(303);
    expect(unlinkResponse.headers.get("location")).toBe(
      `/e/${created.slug}/settings?notice=discord-unlinked`,
    );
    expect(await participantDiscordUserId(participantId)).toBeNull();

    const noticeHtml = await (
      await viewer.get(`/e/${created.slug}/settings?notice=discord-unlinked`)
    ).text();
    expect(noticeHtml).toContain("Discord の紐付けを解除しました");

    // cookie(ログイン状態)は変わらない。
    const home = await viewer.get(`/e/${created.slug}/`);
    expect(await home.text()).toContain(`data-participant="${participantId}"`);
  });

  it("未紐付けで discordEnabled のイベントでは案内文を出す", async () => {
    const created = await createEvent({ discordEnabled: true });
    const viewer = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(viewer, created.slug, { displayName: "山田4" });
    const html = await (await viewer.get(`/e/${created.slug}/settings`)).text();
    expect(html).not.toContain("Discord アカウントと紐付いています");
    expect(html).toContain("Discord の /bandoff open から開くと紐付けられます");
  });

  it("未紐付けで discordEnabled でないイベントでは何も出さない", async () => {
    const created = await createEvent({ discordEnabled: false });
    const viewer = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(viewer, created.slug, { displayName: "山田5" });
    const html = await (await viewer.get(`/e/${created.slug}/settings`)).text();
    expect(html).not.toContain("Discord アカウントと紐付いています");
    expect(html).not.toContain("/bandoff open から開くと紐付けられます");
  });

  it("Discord の ID・名前は画面に出さない", async () => {
    const created = await createEvent();
    const viewer = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(viewer, created.slug, { displayName: "山田6" });
    const participantId = await findParticipantIdInEvent(created.slug, "山田6");
    const discordUserId = "700000000000000091";
    await linkParticipantDirectly(participantId, discordUserId);
    const html = await (await viewer.get(`/e/${created.slug}/settings`)).text();
    expect(html).not.toContain(discordUserId);
  });
});
