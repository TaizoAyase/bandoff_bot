import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../../src/db/client";
import { event as eventTable } from "../../src/db/schema";
import app from "../../src/index";
import { redactPath } from "../../src/middleware/csrf";
import { createEvent, createTestClient } from "../helpers";

const SAME_ORIGIN = "http://localhost";

const NEW_EVENT_BODY = new URLSearchParams({
  title: "CSRFテストオフ会",
  region: "東京",
  startsDate: "2026-09-20",
  startsTime: "19:00",
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

describe("redactPath: 診断ログに残す前に slug を伏せる", () => {
  it("/e/{slug}/join の slug を * に置換する", () => {
    expect(redactPath("/e/abcdefghijklmnopqrstuvwxyz/join")).toBe("/e/*/join");
  });

  it("/e/{slug}/ の slug を * に置換する", () => {
    expect(redactPath("/e/abcdefghijklmnopqrstuvwxyz/")).toBe("/e/*/");
  });

  it("/e/ 配下でないパスはそのまま返す", () => {
    expect(redactPath("/new")).toBe("/new");
  });

  it("戻り値に slug の実値を含まない", () => {
    const slug = "abcdefghijklmnopqrstuvwxyz";
    expect(redactPath(`/e/${slug}/join`)).not.toContain(slug);
  });
});

describe("csrf: 403 の直前に診断ログを残す", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("/e/{slug}/join への拒否で、ログの path が redactPath を経由し slug を含まない", async () => {
    const created = await createEvent();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Sec-Fetch-Site も Origin も付けないので Origin 検査(フォールバック)で
    // 弾かれる。
    const response = await app.request(
      `/e/${created.slug}/join`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ joinCode: created.joinCode }).toString(),
      },
      env,
    );
    expect(response.status).toBe(403);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [, details] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(details.path).toBe("/e/*/join");
    // path 以外のフィールドを含め、slug の実値がどこにも紛れ込んでいない
    // ことを確認する(将来フィールドを増やしたときの漏れも検知できるよう、
    // オブジェクト全体を文字列化して検査する)。
    expect(JSON.stringify(details)).not.toContain(created.slug);
  });
});
