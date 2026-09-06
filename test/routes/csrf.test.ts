import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import { event as eventTable } from "../../src/db/schema";
import app from "../../src/index";
import { createTestClient } from "../helpers";

const SAME_ORIGIN = "http://localhost";

const NEW_EVENT_BODY = new URLSearchParams({
  title: "CSRFテストオフ会",
  region: "東京",
  startsAt: "2026-09-20T19:00",
  place: "スタジオA",
  notes: "",
  joinCode: "himitsu",
  organizerDisplayName: "山田",
  organizerInstruments: "Gt",
}).toString();

/**
 * `csrf` ミドルウェアの判定ロジック(Sec-Fetch-Site 優先、Origin はフォール
 * バック)を、`/new` への直接リクエストで検証する。
 *
 * このアプリは `Referrer-Policy: no-referrer` を返すため、実ブラウザの
 * `<form method="post">` 送信は `Origin: null` + `Sec-Fetch-Site: same-origin`
 * になる(仕様書 41 行目、csrf.ts のコメント参照)。
 */
async function postNew(headers: Record<string, string>): Promise<Response> {
  return app.request(
    "/new",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: NEW_EVENT_BODY,
    },
    env,
  );
}

describe("CSRF: Sec-Fetch-Site を優先し、なければ Origin にフォールバックする", () => {
  it("Origin: null + Sec-Fetch-Site: same-origin は通過する(ブラウザのフォーム送信)", async () => {
    const response = await postNew({
      origin: "null",
      "sec-fetch-site": "same-origin",
    });
    expect(response.status).toBe(200);

    // 実際にイベントが作成されたことまで確認する。
    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(eventTable)
      .where(eq(eventTable.title, "CSRFテストオフ会"));
    expect(rows).toHaveLength(1);
  });

  it("Origin: null のみ(Sec-Fetch-Site なし)は 403 になる", async () => {
    const response = await postNew({ origin: "null" });
    expect(response.status).toBe(403);
  });

  it("Origin 一致 + Sec-Fetch-Site: cross-site は 403 になる(Sec-Fetch-Site 優先)", async () => {
    const response = await postNew({
      origin: SAME_ORIGIN,
      "sec-fetch-site": "cross-site",
    });
    expect(response.status).toBe(403);
  });

  it("Origin 一致 + Sec-Fetch-Site: same-site は 403 になる", async () => {
    const response = await postNew({
      origin: SAME_ORIGIN,
      "sec-fetch-site": "same-site",
    });
    expect(response.status).toBe(403);
  });

  it("Origin 一致 + Sec-Fetch-Site: none は 403 になる", async () => {
    const response = await postNew({
      origin: SAME_ORIGIN,
      "sec-fetch-site": "none",
    });
    expect(response.status).toBe(403);
  });

  it("Sec-Fetch-Site なし + Origin 一致は通過する(curl / 旧ブラウザのフォールバック)", async () => {
    const response = await postNew({ origin: SAME_ORIGIN });
    expect(response.status).toBe(200);
  });

  it("Sec-Fetch-Site なし + Origin 不一致は 403 になる", async () => {
    const response = await postNew({ origin: "http://evil.example" });
    expect(response.status).toBe(403);
  });

  it("Sec-Fetch-Site なし + Origin なしは 403 になる", async () => {
    const response = await postNew({});
    expect(response.status).toBe(403);
  });

  it("GET は検査されない", async () => {
    const client = createTestClient();
    const response = await client.get("/");
    expect(response.status).toBe(200);
  });
});
