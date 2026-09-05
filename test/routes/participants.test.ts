import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import { assignment, event as eventTable, participant } from "../../src/db/schema";
import {
  createEvent,
  createSong,
  createTestClient,
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
