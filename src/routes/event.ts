import { Hono } from "hono";
import type { AppEnv } from "../env";
import { eventMiddleware } from "../middleware/event";
import { sessionMiddleware } from "../middleware/session";

/**
 * `/e/:slug` 配下のサブアプリの骨格。
 * slug 検証・Event 解決・viewer 解決までをここで済ませる。
 * 具体的なルート(曲一覧・登録・参加など)は M2 以降で追加する。
 */
export const eventApp = new Hono<AppEnv>({ strict: false });

eventApp.use("*", eventMiddleware);
eventApp.use("*", sessionMiddleware);
