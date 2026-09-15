import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { createEvent } from "../helpers";

/**
 * N1(新規イベント作成)の通知本文に足す「Discord の `/bandoff open` で
 * 開けます」の1行(計画7章)。`event.discord_enabled` かつコマンド有効
 * (`DISCORD_PUBLIC_KEY` / `DISCORD_GUILD_ID` が両方設定されている)の
 * ときだけ付く。
 *
 * `test/routes/notify-new-event.test.ts` と同じ理由で、N1 の通知は
 * サイト全体で直近1時間に作られたイベント数に依存するレート制限
 * (3件/時)を持つ。D1 のストレージ分離はファイル単位なので
 * ([[vitest-pool-workers-storage-per-file]])、このファイル内で
 * `createEvent()` を4回以上呼ぶと4件目以降の通知が意図せず省かれてしまう。
 * そのため、シナリオを1つの `it` にまとめ、上限(3件)以内に収める。
 */
const BOT_TOKEN = "test-bot-token";
const CHANNEL_ID = "123456789012345678";

let originalBotToken: string | undefined;
let originalChannelId: string | undefined;
let originalPublicKey: string | undefined;
let originalGuildId: string | undefined;
let capturedBodies: string[];
let fetchSpy: Mock<typeof fetch>;

beforeEach(() => {
  originalBotToken = env.DISCORD_BOT_TOKEN;
  originalChannelId = env.DISCORD_CHANNEL_ID;
  originalPublicKey = env.DISCORD_PUBLIC_KEY;
  originalGuildId = env.DISCORD_GUILD_ID;
  env.DISCORD_BOT_TOKEN = BOT_TOKEN;
  env.DISCORD_CHANNEL_ID = CHANNEL_ID;
  capturedBodies = [];
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    capturedBodies.push(String(init?.body ?? ""));
    return new Response(null, { status: 204 });
  });
});

afterEach(() => {
  env.DISCORD_BOT_TOKEN = originalBotToken as string;
  env.DISCORD_CHANNEL_ID = originalChannelId as string;
  env.DISCORD_PUBLIC_KEY = originalPublicKey as string;
  env.DISCORD_GUILD_ID = originalGuildId as string;
  vi.restoreAllMocks();
});

function contentAt(index: number): string {
  const body = capturedBodies[index];
  if (!body) throw new Error(`fetch was not called for index ${index}`);
  return (JSON.parse(body) as { content: string }).content;
}

describe("新規イベント通知の「/bandoff open」の1行(計画7章)", () => {
  it("discordEnabled とコマンド有効(DISCORD_PUBLIC_KEY・DISCORD_GUILD_ID)の両方が揃ったときだけ1行が足される", async () => {
    // 1件目: discordEnabled = true・コマンド有効 → 1行足される。
    env.DISCORD_PUBLIC_KEY = "a".repeat(64);
    env.DISCORD_GUILD_ID = "900000000000000001";
    const enabled = await createEvent({
      title: "コマンド有効イベント",
      discordEnabled: true,
    });
    expect(enabled.response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(contentAt(0)).toContain("- Discord の `/bandoff open` で開けます");

    // 2件目: discordEnabled = false・コマンド有効 → 1行足されない。
    const disabled = await createEvent({
      title: "個別に無効化したイベント",
      discordEnabled: false,
    });
    expect(disabled.response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(contentAt(1)).not.toContain("/bandoff open");

    // 3件目: discordEnabled = true・コマンド無効(片方だけ設定) →
    // 1行足されない。
    env.DISCORD_GUILD_ID = "";
    const partiallyConfigured = await createEvent({
      title: "片方だけ設定イベント",
      discordEnabled: true,
    });
    expect(partiallyConfigured.response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(contentAt(2)).not.toContain("/bandoff open");
  });
});
