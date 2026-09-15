import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import * as eventsQueries from "../../src/db/queries/events";
import { createEvent } from "../helpers";

/**
 * 計画6章「本文作成のクエリが失敗しても操作は成功する」の検証。
 *
 * N1(新規イベント作成)の通知本文作成では、レート制限判定のために
 * `countEventsCreatedSince` で D1 に問い合わせる(`src/routes/root.ts` の
 * `scheduleNotification` に渡す `build` クロージャの中)。このクエリが
 * 失敗しても:
 *
 * (a) イベント作成自体(welcome ページの表示・鍵一式の発行)は成功する
 * (b) 本文が作れないので Discord へは送信されない(fetch が呼ばれない)
 * (c) `console.warn` にはエラーの種類だけが出て、エラーメッセージ本文や
 *     ユーザー入力値は出ない
 *
 * ことを固定する。`scheduleNotification`(src/notify/schedule.ts)は
 * `build` の reject を内部の try/catch で握りつぶして正常終了するため、
 * `waitOnExecutionContext`(`test/helpers.ts` の `request()` が毎回
 * 自動で待つ)が reject して vitest が unhandled rejection を報告する
 * こともない(このテストが例外なく完走すること自体がその確認になる)。
 */
const BOT_TOKEN = "test-bot-token";
const CHANNEL_ID = "123456789012345678";

let originalBotToken: string | undefined;
let originalChannelId: string | undefined;
let fetchSpy: Mock<typeof fetch>;

beforeEach(() => {
  originalBotToken = env.DISCORD_BOT_TOKEN;
  originalChannelId = env.DISCORD_CHANNEL_ID;
  env.DISCORD_BOT_TOKEN = BOT_TOKEN;
  env.DISCORD_CHANNEL_ID = CHANNEL_ID;
  fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 204 }));
});

afterEach(() => {
  env.DISCORD_BOT_TOKEN = originalBotToken as string;
  env.DISCORD_CHANNEL_ID = originalChannelId as string;
  vi.restoreAllMocks();
});

describe("Discord Bot 通知: 本文作成のクエリが失敗しても操作は成功する", () => {
  it("N1: countEventsCreatedSince が reject してもイベント作成は成功し、通知は送られない", async () => {
    const secretDetail = "接続文字列 postgres://user:pass@host/db に到達できない";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(eventsQueries, "countEventsCreatedSince").mockRejectedValue(
      new Error(`db unreachable: ${secretDetail}`),
    );

    const created = await createEvent({ title: "本文作成失敗テスト" });

    // (a) ルートは通常どおり成功する(welcome ページが返り、鍵一式も発行される)。
    expect(created.response.status).toBe(200);
    expect(created.slug).toBeTruthy();
    expect(created.organizerKey).toBeTruthy();

    // (b) 本文作成が失敗しているので Discord へは送られない。
    expect(fetchSpy).not.toHaveBeenCalled();

    // (c) console.warn にはエラーの種類だけが出て、エラーメッセージ本文や
    // ユーザー入力値は出ない。
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message, meta] = warnSpy.mock.calls[0] ?? [];
    expect(message).toBe("discord notify failed");
    expect(meta).toEqual({ error: "Error" });
    const loggedText = JSON.stringify(warnSpy.mock.calls[0]);
    expect(loggedText).not.toContain(secretDetail);
    expect(loggedText).not.toContain("本文作成失敗テスト");
  });
});
