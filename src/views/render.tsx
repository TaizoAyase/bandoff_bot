import type { Context } from "hono";
import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * JSX で組んだページに DOCTYPE を付けて `c.html()` に渡す。
 */
export async function renderPage(
  c: Context,
  node: HtmlEscapedString | Promise<HtmlEscapedString>,
  status: ContentfulStatusCode = 200,
): Promise<Response> {
  const body = await html`<!doctype html>${node}`;
  return c.html(body, status);
}
