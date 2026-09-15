import { Hono } from "hono";
import { createDb } from "./db/client";
import type { AppEnv } from "./env";
import { csrf } from "./middleware/csrf";
import { securityHeaders } from "./middleware/security-headers";
import { discordInteractionsApp } from "./routes/discord-interactions";
import { eventApp } from "./routes/event";
import { rootApp } from "./routes/root";
import { errorResponse, notFoundResponse } from "./views/pages/error";
import { HomePage } from "./views/pages/home";
import { renderPage } from "./views/render";

const app = new Hono<AppEnv>({ strict: false });

app.use("*", securityHeaders);
app.use("*", csrf);
app.use("*", async (c, next) => {
  c.set("db", createDb(c.env.DB));
  await next();
});

app.get("/", (c) => renderPage(c, HomePage()));

app.route("/", rootApp);
app.route("/discord", discordInteractionsApp);
app.route("/e/:slug", eventApp);

app.notFound((c) => notFoundResponse(c));

app.onError((err, c) => {
  // URL・入力値は出さない。トリアージに必要な最小限の情報のみ記録する。
  console.error("unhandled error", err instanceof Error ? err.name : typeof err);
  return errorResponse(c, 500, "エラーが発生しました");
});

export default app;
