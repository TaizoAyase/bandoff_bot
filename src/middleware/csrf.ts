import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { errorResponse } from "../views/pages/error";

// このアプリのフォームは GET / POST のみを使う(PUT/DELETE は将来の拡張に
// 備えて含めているが未使用)。PATCH は想定していないため含めていない。
const UNSAFE_METHODS = new Set(["POST", "PUT", "DELETE"]);

/**
 * SameSite=Lax の cookie と組み合わせた CSRF 対策。
 *
 * このアプリは `Referrer-Policy: no-referrer` を返している(security-headers.ts、
 * docs/bandoff-spec.md の要件)。Fetch 仕様の「append a request Origin header」
 * アルゴリズムでは、リクエストの referrer policy が `no-referrer` の場合、
 * CORS モードでないリクエスト(`<form method="post">` によるナビゲーション等)の
 * Origin ヘッダは `null` になる。Chrome / Firefox はこれを実装しているため、
 * 通常のフォーム送信はすべて `Origin: null` で届く。一方 `fetch()` による POST は
 * CORS モードのため、`null` にはならず実オリジンが付く。
 *
 * そのため Origin の完全一致だけでは通常のフォーム送信を判別できない。
 * 代わりに、モダンブラウザが常に送る Fetch Metadata の `Sec-Fetch-Site` を
 * 優先的に見る。これはページ内の JS から書き換えられないヘッダで、
 * `same-origin` であれば同一オリジンからのリクエストであることが保証される。
 * `Sec-Fetch-Site` が存在しない場合(古いブラウザや curl 等)のみ、
 * 従来どおり Origin ヘッダの完全一致にフォールバックする。
 */
export const csrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (UNSAFE_METHODS.has(c.req.method)) {
    const secFetchSite = c.req.header("sec-fetch-site");
    if (secFetchSite !== undefined) {
      // Fetch Metadata が送られてきている場合はこちらを信頼する。
      // same-origin 以外(cross-site / same-site / none)はすべて拒否する。
      if (secFetchSite !== "same-origin") {
        return errorResponse(c, 403, "不正なリクエストです");
      }
    } else {
      // フォールバック: Origin ヘッダの完全一致で判定する。
      // 欠落・"null"・不一致はすべて 403 とする。
      const origin = c.req.header("origin");
      const expected = new URL(c.req.url).origin;
      if (!origin || origin !== expected) {
        return errorResponse(c, 403, "不正なリクエストです");
      }
    }
  }
  await next();
};
