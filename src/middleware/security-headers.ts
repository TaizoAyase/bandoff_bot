import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "../env";

/**
 * Discord の外に情報が漏れないためのヘッダ群。
 * - CSP: inline style / handler / script はすべて禁止(`'self'` のみ)
 * - Referrer-Policy: `no-referrer`(secureHeaders の既定値)
 * - X-Robots-Tag: 検索エンジン・クローラからの除外
 */
const withSecureHeaders = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", "data:"],
    connectSrc: ["'self'"],
    formAction: ["'self'"],
    baseUri: ["'none'"],
    frameAncestors: ["'none'"],
  },
});

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await withSecureHeaders(c, next);
  c.header("X-Robots-Tag", "noindex, nofollow");
};
