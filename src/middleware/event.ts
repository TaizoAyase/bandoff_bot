import type { MiddlewareHandler } from "hono";
import { findEventBySlug } from "../db/queries/events";
import { isValidSlug } from "../domain/ids";
import type { AppEnv } from "../env";
import { notFoundResponse } from "../views/pages/error";

/**
 * `:slug` パスパラメータを検証し、対応する Event を `c.set("event", ...)` する。
 * slug の形式が不正な場合は DB を引かずに 404。イベントが存在しない場合も
 * 同じ汎用 404 を返し、存在有無を外部から区別できないようにする。
 */
export const eventMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const slug = c.req.param("slug");
  if (!slug || !isValidSlug(slug)) {
    return notFoundResponse(c);
  }

  const event = await findEventBySlug(c.get("db"), slug);
  if (!event) {
    return notFoundResponse(c);
  }

  c.set("event", event);
  await next();
};
