import { describe, expect, it } from "vitest";
import { createEvent, createTestClient, joinAsViewer } from "../helpers";

/**
 * 曲一覧ページはイベント名・日時・場所を表示する(`EventInfo`)。これらが
 * 認証前のリクエストに漏れないことを固定する。
 *
 * 仕様書の「合言葉画面にイベント名を出さない」と、docs/development.md の「OGP メタを
 * 出さない(Discord のプロキシがページを取得して埋め込みを生成するため)」は
 * どちらも「URL を知っただけの相手にイベントの中身を渡さない」ための規定で、
 * 実際に守っているのは `requireViewer` の 303 リダイレクトである。
 * `<title>` にイベント名を載せた以上、この砦が崩れると即座に漏洩するため、
 * リダイレクトの有無ではなく**レスポンス本文にイベント名が含まれないこと**を
 * 直接検証する。
 */
const SECRET = {
  title: "内緒のオフ会ZZZ",
  place: "スタジオQQQ",
  region: "架空県WWW",
} as const;

describe("認証前のレスポンスにイベント情報が含まれない", () => {
  it("未認証で曲一覧を要求しても本文にイベント名が出ない", async () => {
    const created = await createEvent(SECRET);
    const anonymous = createTestClient();
    const response = await anonymous.get(`/e/${created.slug}/`);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/e/${created.slug}/join`);
    const html = await response.text();
    expect(html).not.toContain(SECRET.title);
    expect(html).not.toContain(SECRET.place);
  });

  it("合言葉画面にイベント名・場所・地域が出ない", async () => {
    const created = await createEvent(SECRET);
    const anonymous = createTestClient();
    const response = await anonymous.get(`/e/${created.slug}/join`);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).not.toContain(SECRET.title);
    expect(html).not.toContain(SECRET.place);
    expect(html).not.toContain(SECRET.region);
  });

  it("合言葉を通した viewer には曲一覧でイベント名が出る(対照)", async () => {
    const created = await createEvent(SECRET);
    const client = await joinAsViewer(created.slug, created.joinCode);
    const response = await client.get(`/e/${created.slug}/`);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(SECRET.title);
    expect(html).toContain(SECRET.place);
  });
});
