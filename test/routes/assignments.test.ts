import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import { assignment, event as eventTable } from "../../src/db/schema";
import {
  createEvent,
  createSong,
  createTestClient,
  findFirstSongSlotIds,
  joinAsViewer,
  registerParticipant,
} from "../helpers";

async function setupEventWithSong() {
  const created = await createEvent();
  await createSong(created.client, created.slug, { title: "テスト曲" });
  const ids = await findFirstSongSlotIds(created.slug);
  return { ...created, slotIds: ids };
}

async function closeEvent(slug: string): Promise<void> {
  const db = createDb(env.DB);
  await db
    .update(eventTable)
    .set({ status: "closed" })
    .where(eq(eventTable.slug, slug));
}

describe("POST /e/:slug/slots/:id/join", () => {
  it("redirects an unregistered viewer to /register?slot=", async () => {
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    const slotId = setup.slotIds[0] ?? "";
    const response = await client.post(`/e/${setup.slug}/slots/${slotId}/join`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `/e/${setup.slug}/register?slot=${encodeURIComponent(slotId)}`,
    );
  });

  it("succeeds with a 303 redirect and a joined notice", async () => {
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(client, setup.slug, { displayName: "鈴木" });

    const slotId = setup.slotIds[0] ?? "";
    // ブラウザの <form method="post"> 送信(Origin: null)を模した経路でも
    // 通ることを確認する。
    const response = await client.postAsBrowserForm(
      `/e/${setup.slug}/slots/${slotId}/join`,
    );
    expect(response.status).toBe(303);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("notice=joined");

    const listResponse = await client.get(`/e/${setup.slug}/`);
    const html = await listResponse.text();
    expect(html).toContain("鈴木");
  });

  it("shows a confirmation page for a second slot in the same take, and confirm=1 proceeds", async () => {
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(client, setup.slug, { displayName: "鈴木" });

    const [firstSlotId, secondSlotId] = setup.slotIds;
    if (!firstSlotId || !secondSlotId) throw new Error("expected at least 2 slots");

    await client.post(`/e/${setup.slug}/slots/${firstSlotId}/join`);

    const confirmResponse = await client.post(
      `/e/${setup.slug}/slots/${secondSlotId}/join`,
    );
    expect(confirmResponse.status).toBe(200);
    const confirmHtml = await confirmResponse.text();
    expect(confirmHtml).toContain("それでもエントリーする");

    const proceedResponse = await client.post(
      `/e/${setup.slug}/slots/${secondSlotId}/join`,
      { confirm: "1" },
    );
    expect(proceedResponse.status).toBe(303);
  });

  it("returns 409 with a 'taken' page when the slot is already filled", async () => {
    const setup = await setupEventWithSong();
    const clientA = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(clientA, setup.slug, { displayName: "Aさん" });
    const clientB = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(clientB, setup.slug, { displayName: "Bさん" });

    const slotId = setup.slotIds[0] ?? "";
    const first = await clientA.post(`/e/${setup.slug}/slots/${slotId}/join`);
    expect(first.status).toBe(303);

    const second = await clientB.post(`/e/${setup.slug}/slots/${slotId}/join`);
    expect(second.status).toBe(409);
    const html = await second.text();
    expect(html).toContain("先を越されました");
  });

  it("is forbidden for participants once the event is closed, but still allowed for the organizer", async () => {
    const setup = await setupEventWithSong();
    const client = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(client, setup.slug, { displayName: "鈴木" });

    const db = createDb(env.DB);
    await db
      .update(eventTable)
      .set({ status: "closed" })
      .where(eq(eventTable.slug, setup.slug));

    const slotId = setup.slotIds[0] ?? "";
    const blocked = await client.post(`/e/${setup.slug}/slots/${slotId}/join`);
    expect(blocked.status).toBe(403);

    // 主催者は closed でも入れる。
    const organizerResponse = await setup.client.post(
      `/e/${setup.slug}/slots/${slotId}/join`,
    );
    expect(organizerResponse.status).toBe(303);
  });

  it("closed だと未登録 viewer の join は register へ誘導されず 403 になる", async () => {
    const setup = await setupEventWithSong();
    await closeEvent(setup.slug);

    const client = await joinAsViewer(setup.slug, setup.joinCode);
    const slotId = setup.slotIds[0] ?? "";
    const response = await client.post(`/e/${setup.slug}/slots/${slotId}/join`);
    expect(response.status).toBe(403);
    expect(response.status).not.toBe(303);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(assignment)
      .where(eq(assignment.slotId, slotId));
    expect(rows).toHaveLength(0);
  });

  it("他イベントの slot id を join に渡すと 404 になり assignment は増えない", async () => {
    const eventA = await setupEventWithSong();
    const eventB = await setupEventWithSong();
    const eventBSlotId = eventB.slotIds[0] ?? "";

    // eventA の主催者 client(participant 登録済み)で、eventB の slot id を叩く。
    const response = await eventA.client.post(
      `/e/${eventA.slug}/slots/${eventBSlotId}/join`,
    );
    expect(response.status).toBe(404);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(assignment)
      .where(eq(assignment.slotId, eventBSlotId));
    expect(rows).toHaveLength(0);
  });
});

describe("POST /e/:slug/slots/:id/leave", () => {
  it("frees the slot so someone else can take it", async () => {
    const setup = await setupEventWithSong();
    const clientA = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(clientA, setup.slug, { displayName: "Aさん" });
    const slotId = setup.slotIds[0] ?? "";
    await clientA.post(`/e/${setup.slug}/slots/${slotId}/join`);

    const leaveResponse = await clientA.post(`/e/${setup.slug}/slots/${slotId}/leave`);
    expect(leaveResponse.status).toBe(303);
    expect(leaveResponse.headers.get("location")).toContain("notice=left");

    const clientB = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(clientB, setup.slug, { displayName: "Bさん" });
    const secondJoin = await clientB.post(`/e/${setup.slug}/slots/${slotId}/join`);
    expect(secondJoin.status).toBe(303);
  });

  it("forbids leaving someone else's assignment", async () => {
    const setup = await setupEventWithSong();
    const clientA = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(clientA, setup.slug, { displayName: "Aさん" });
    const slotId = setup.slotIds[0] ?? "";
    await clientA.post(`/e/${setup.slug}/slots/${slotId}/join`);

    const clientB = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(clientB, setup.slug, { displayName: "Bさん" });

    const response = await clientB.post(`/e/${setup.slug}/slots/${slotId}/leave`);
    expect(response.status).toBe(403);
  });

  it("allows the organizer to leave someone else's assignment", async () => {
    const setup = await setupEventWithSong();
    const clientA = await joinAsViewer(setup.slug, setup.joinCode);
    await registerParticipant(clientA, setup.slug, { displayName: "Aさん" });
    const slotId = setup.slotIds[0] ?? "";
    await clientA.post(`/e/${setup.slug}/slots/${slotId}/join`);

    const response = await setup.client.post(`/e/${setup.slug}/slots/${slotId}/leave`);
    expect(response.status).toBe(303);
  });
});

describe("closed events remain readable for participants", () => {
  it("still allows GET / for a participant when closed", async () => {
    const setup = await setupEventWithSong();
    const db = createDb(env.DB);
    await db
      .update(eventTable)
      .set({ status: "closed" })
      .where(eq(eventTable.slug, setup.slug));
    const response = await setup.client.get(`/e/${setup.slug}/`);
    expect(response.status).toBe(200);
  });
});

describe("unauthenticated access", () => {
  it("returns 401 for fragments without a valid session, not a redirect", async () => {
    const setup = await setupEventWithSong();
    const client = createTestClient();
    const response = await client.get(`/e/${setup.slug}/fragments/songs`);
    expect(response.status).toBe(401);
  });
});
