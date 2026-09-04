import { Hono } from "hono";
import type { AppEnv } from "../env";
import { eventMiddleware } from "../middleware/event";
import { sessionMiddleware } from "../middleware/session";
import { authApp } from "./auth";
import { pagesApp } from "./pages";
import { participantsApp } from "./participants";
import { songsApp } from "./songs";

/**
 * `/e/:slug` 配下のサブアプリの骨格。
 * slug 検証・Event 解決・viewer 解決までをここで済ませ、各機能のルートを
 * 束ねる。
 */
export const eventApp = new Hono<AppEnv>({ strict: false });

eventApp.use("*", eventMiddleware);
eventApp.use("*", sessionMiddleware);

eventApp.route("/", authApp);
eventApp.route("/", pagesApp);
eventApp.route("/", participantsApp);
eventApp.route("/", songsApp);
