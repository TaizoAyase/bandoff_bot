import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { errorResponse } from "../views/pages/error";

// このアプリのフォームは GET / POST のみを使う(PUT/DELETE は将来の拡張に
// 備えて含めているが未使用)。PATCH は想定していないため含めていない。
const UNSAFE_METHODS = new Set(["POST", "PUT", "DELETE"]);

/**
 * SameSite=Lax の cookie と組み合わせた CSRF 対策。
 * 書き込み系メソッドで Origin ヘッダが自オリジンと一致しなければ 403 を返す。
 * Origin ヘッダの欠落も 403 とする。
 */
export const csrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (UNSAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header("origin");
    const expected = new URL(c.req.url).origin;
    if (!origin || origin !== expected) {
      return errorResponse(c, 403, "不正なリクエストです");
    }
  }
  await next();
};
