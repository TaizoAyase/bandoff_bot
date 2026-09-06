import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import { event, participant } from "../../src/db/schema";
import { createEvent, createTestClient } from "../helpers";

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
      organizerPassword: "hunter2",
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
      organizerPassword: "",
      organizerDisplayName: "",
      organizerInstruments: "",
    });
    expect(response.status).toBe(400);
  });
});
