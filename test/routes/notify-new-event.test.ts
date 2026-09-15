import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { formatEventPeriod, parseJstDateTimeLocal } from "../../src/domain/time";
import { createEvent } from "../helpers";

/**
 * N1(新規イベント作成、POST /new)の通知は、荒らし対策として「直近1時間に
 * サイト全体で作られたイベントが3件を超えたら通知だけを省く」という、
 * イベント単体ではなく D1 全体の件数に依存するレート制限を持つ(計画3章)。
 *
 * D1 のストレージ分離はテストファイル単位でしか行われない
 * ([[vitest-pool-workers-storage-per-file]])。他のテストファイルで作られる
 * イベントはこのファイルの D1 には影響しないが、逆にこのファイル内で複数の
 * `it` にまたがってイベントを作ると件数が意図せず積み上がってしまう。
 * そのため、本文の内容確認と件数境界の確認をあえて1つの `it` にまとめ、
 * 実行順序に依存しない自己完結したテストにする。
 */
const BOT_TOKEN = "test-bot-token";
const CHANNEL_ID = "123456789012345678";
const EXPECTED_URL = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`;

interface CapturedRequest {
  url: string;
  body: string;
}

let originalBotToken: string | undefined;
let originalChannelId: string | undefined;
let capturedRequests: CapturedRequest[];
let fetchSpy: Mock<typeof fetch>;

beforeEach(() => {
  originalBotToken = env.DISCORD_BOT_TOKEN;
  originalChannelId = env.DISCORD_CHANNEL_ID;
  env.DISCORD_BOT_TOKEN = BOT_TOKEN;
  env.DISCORD_CHANNEL_ID = CHANNEL_ID;
  capturedRequests = [];
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    capturedRequests.push({
      url: typeof input === "string" ? input : input.toString(),
      body: String(init?.body ?? ""),
    });
    return new Response(null, { status: 204 });
  });
});

afterEach(() => {
  env.DISCORD_BOT_TOKEN = originalBotToken as string;
  env.DISCORD_CHANNEL_ID = originalChannelId as string;
  vi.restoreAllMocks();
});

function requestBodyAt(index: number): { content: string } {
  const request = capturedRequests[index];
  if (!request) throw new Error(`fetch was not called for index ${index}`);
  return JSON.parse(request.body) as { content: string };
}

describe("Discord Bot 通知: 新規イベント作成(POST /new)", () => {
  it("本文にイベント情報が入り、直近1時間に4件を超えたら4件目の通知だけ省かれる(作成自体は成功する)", async () => {
    // 1件目: 本文の内容(イベント名・主催者・地域・日時・場所)を確認する。
    // URL・合言葉・主催者キー等の秘密情報は計画のユーザー決定事項により
    // 含めない。
    const first = await createEvent({
      title: "〇〇オフ会 vol.3",
      region: "東京",
      startsDate: "2026-09-05",
      startsTime: "19:00",
      durationMinutes: "180",
      place: "スタジオA",
      organizerDisplayName: "山田",
      joinCode: "himitsu-code",
    });
    expect(first.response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(capturedRequests[0]?.url).toBe(EXPECTED_URL);
    const firstBody = requestBodyAt(0);
    const expectedPeriod = formatEventPeriod(
      parseJstDateTimeLocal("2026-09-05T19:00"),
      180,
    );
    expect(firstBody.content).toBe(
      [
        "〔〇〇オフ会 vol.3〕山田さんが新しいオフ会を作成しました",
        "- 地域: 東京",
        `- 日時: ${expectedPeriod}`,
        "- 場所: スタジオA",
      ].join("\n"),
    );
    // 秘密情報は本文にもURL(チャンネルIDのみを含む)にも含まれない。
    expect(firstBody.content).not.toContain(first.slug);
    expect(firstBody.content).not.toContain(first.joinCode);
    expect(firstBody.content).not.toContain(first.organizerKey);
    expect(firstBody.content).not.toContain(first.token);
    expect(firstBody.content).not.toContain(first.recoveryKey);
    expect(firstBody.content).not.toContain("http");
    expect(capturedRequests[0]?.url).not.toContain(first.slug);

    // 2件目・3件目: 引き続きサイト全体の件数が3件以下なので通知される。
    const second = await createEvent({ title: "2件目のオフ会" });
    expect(second.response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const third = await createEvent({ title: "3件目のオフ会" });
    expect(third.response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // 4件目: 作成自体は成功する(welcome ページが返り、鍵一式も発行される)が、
    // サイト全体で直近1時間に作られたイベントが3件を超えるため、通知だけが
    // 省かれる(fetch がこれ以上呼ばれない)。
    const fourth = await createEvent({ title: "4件目のオフ会" });
    expect(fourth.response.status).toBe(200);
    expect(fourth.slug).toBeTruthy();
    expect(fourth.organizerKey).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
