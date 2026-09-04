import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import { joinSlot } from "../../src/db/queries/assignments";
import { assignment } from "../../src/db/schema";
import { newId } from "../../src/domain/ids";
import {
  createEvent,
  createSong,
  findFirstSongSlotIds,
  joinAsViewer,
  registerParticipant,
  type TestClient,
} from "../helpers";

/**
 * 仕様 9.5(書き込み競合の防止)の検証。miniflare の D1 は逐次実行のため
 * 真の並列は再現できないが、(1) 条件付き INSERT の原子性、
 * (2) 素の INSERT が UNIQUE 制約に守られていること、
 * (3) ルート層で同時に届いた2件のうち1件だけが通ることを確認する。
 */
describe("同一枠への同時エントリー", () => {
  it("クエリ層: Promise.all([joinSlot, joinSlot]) は1件だけ joined になる", async () => {
    const created = await createEvent();
    await createSong(created.client, created.slug, { title: "並行テスト曲1" });
    const [slotId] = await findFirstSongSlotIds(created.slug);
    if (!slotId) throw new Error("slot not found");

    const clientA = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(clientA, created.slug, { displayName: "Aさん" });
    const clientB = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(clientB, created.slug, { displayName: "Bさん" });
    const participantIdA = await participantIdOf(clientA, created.slug);
    const participantIdB = await participantIdOf(clientB, created.slug);

    const db = createDb(env.DB);
    const now = Math.floor(Date.now() / 1000);
    const [resultA, resultB] = await Promise.all([
      joinSlot(db, { slotId, participantId: participantIdA, now }),
      joinSlot(db, { slotId, participantId: participantIdB, now }),
    ]);

    const kinds = [resultA.kind, resultB.kind].sort();
    expect(kinds).toEqual(["joined", "taken"]);

    const rows = await db
      .select()
      .from(assignment)
      .where(eq(assignment.slotId, slotId));
    expect(rows).toHaveLength(1);
  });

  it("素の INSERT(NOT EXISTS なし)の2回目は UNIQUE 制約違反で reject される", async () => {
    const created = await createEvent();
    await createSong(created.client, created.slug, { title: "並行テスト曲2" });
    const [slotId] = await findFirstSongSlotIds(created.slug);
    if (!slotId) throw new Error("slot not found");

    const clientA = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(clientA, created.slug, { displayName: "Cさん" });
    const clientB = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(clientB, created.slug, { displayName: "Dさん" });
    const participantIdA = await participantIdOf(clientA, created.slug);
    const participantIdB = await participantIdOf(clientB, created.slug);

    const db = createDb(env.DB);
    const now = Math.floor(Date.now() / 1000);
    await db.insert(assignment).values({
      id: newId(),
      slotId,
      participantId: participantIdA,
      note: null,
      createdAt: now,
    });

    await expect(
      db.insert(assignment).values({
        id: newId(),
        slotId,
        participantId: participantIdB,
        note: null,
        createdAt: now,
      }),
    ).rejects.toThrow();
  });

  it("ルート層: 2つの cookie から同時 POST しても303が1つ・409が1つになる", async () => {
    const created = await createEvent();
    await createSong(created.client, created.slug, { title: "並行テスト曲3" });
    const [slotId] = await findFirstSongSlotIds(created.slug);
    if (!slotId) throw new Error("slot not found");

    const clientA = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(clientA, created.slug, { displayName: "Eさん" });
    const clientB = await joinAsViewer(created.slug, created.joinCode);
    await registerParticipant(clientB, created.slug, { displayName: "Fさん" });

    const [responseA, responseB] = await Promise.all([
      clientA.post(`/e/${created.slug}/slots/${slotId}/join`),
      clientB.post(`/e/${created.slug}/slots/${slotId}/join`),
    ]);

    const statuses = [responseA.status, responseB.status].sort();
    expect(statuses).toEqual([303, 409]);
  });
});

/** 曲一覧ページの `data-participant` 属性から、そのクライアントの participant id を読む。 */
async function participantIdOf(client: TestClient, slug: string): Promise<string> {
  const response = await client.get(`/e/${slug}/`);
  const html = await response.text();
  const match = /data-participant="([^"]*)"/.exec(html);
  const id = match?.[1];
  if (!id || id === "0") {
    throw new Error("could not extract participant id from song list html");
  }
  return id;
}
