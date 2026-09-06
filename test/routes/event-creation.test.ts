import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import { event, participant } from "../../src/db/schema";
import {
  createEvent,
  createTestClient,
  joinAsViewer,
  registerParticipant,
} from "../helpers";

describe("POST /new", () => {
  it("creates the event and the organizer participant atomically", async () => {
    // ブラウザの <form method="post"> 送信(Origin: null)を模した経路でも
    // 通ることを確認する。
    const created = await createEvent({
      title: "夏の東京オフ会",
      useBrowserForm: true,
    });
    expect(created.response.status).toBe(200);

    const db = createDb(env.DB);
    const rows = await db.select().from(event).where(eq(event.slug, created.slug));
    expect(rows).toHaveLength(1);
    const eventRow = rows[0];
    expect(eventRow?.organizerParticipantId).not.toBeNull();
    expect(eventRow?.joinCode).toBe(created.joinCode);

    const participantRows = await db
      .select()
      .from(participant)
      .where(eq(participant.id, eventRow?.organizerParticipantId ?? ""));
    expect(participantRows).toHaveLength(1);
    expect(participantRows[0]?.displayName).toBe("主催者");
  });

  it("sets a session cookie scoped to the event path", async () => {
    const client = createTestClient();
    const response = await client.post("/new", {
      title: "テストオフ会",
      region: "東京",
      startsAt: "2026-09-05T19:00",
      place: "スタジオA",
      notes: "",
      joinCode: "himitsu",
      organizerDisplayName: "主催者",
      organizerInstruments: "Gt",
    });
    const setCookie = response.headers.getSetCookie()[0] ?? "";
    expect(setCookie).toContain("bandoff_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toMatch(/Path=\/e\/[a-z2-7]{26}/);
  });

  it("shows the recovery key and the paste text on the welcome page", async () => {
    const created = await createEvent({ title: "夏の東京オフ会" });
    expect(created.html).toContain(created.recoveryKey);
    expect(created.html).toContain(created.slug);
    expect(created.html).toContain("夏の東京オフ会");
    expect(created.html).toContain(created.joinCode);
    expect(created.html).toContain('data-copy-target="recovery-key"');
  });

  it("does not include OGP meta tags", async () => {
    const created = await createEvent();
    expect(created.html).not.toMatch(/property=["']og:/);
  });

  it("re-renders the form with errors when the input is invalid", async () => {
    const client = createTestClient();
    const response = await client.post("/new", {
      title: "",
      region: "",
      startsAt: "",
      place: "",
      notes: "",
      joinCode: "",
      organizerDisplayName: "",
      organizerInstruments: "",
    });
    expect(response.status).toBe(400);
  });
});

describe("welcome ページの主催者キー(作成経路のみに渡す)", () => {
  const ORGANIZER_KEY_PATTERN =
    /^[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/;

  it("includes an organizer key matching the XXXX-XXXX-XXXX charset on the creation welcome page", async () => {
    const created = await createEvent();
    expect(created.html).toContain('data-copy-target="organizer-key"');
    expect(created.organizerKey).toMatch(ORGANIZER_KEY_PATTERN);
  });

  it("does not include an organizer key on the participant registration welcome page", async () => {
    const created = await createEvent();
    const client = await joinAsViewer(created.slug, created.joinCode);
    const { html } = await registerParticipant(client, created.slug, {
      displayName: "登録テスト太郎",
    });
    expect(html).not.toContain("data-organizer-key");
  });

  it("does not include an organizer key on the recovery welcome page", async () => {
    const created = await createEvent();
    const client = createTestClient();
    await client.post(`/e/${created.slug}/join`, { joinCode: created.joinCode });
    const response = await client.post(`/e/${created.slug}/recover`, {
      recoveryKey: created.recoveryKey,
    });
    const html = await response.text();
    expect(html).not.toContain("data-organizer-key");
  });
});
