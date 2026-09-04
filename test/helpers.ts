import { env } from "cloudflare:test";
import app from "../src/index";

const ORIGIN = "http://localhost";

export type PostBody =
  | string
  | URLSearchParams
  | FormData
  | Record<string, string>
  | undefined;

export interface TestClient {
  /** cookie jar を維持したまま任意のメソッドでリクエストする。 */
  request(path: string, init?: RequestInit): Promise<Response>;
  /** GET リクエスト。 */
  get(path: string, init?: RequestInit): Promise<Response>;
  /** POST リクエスト。Origin ヘッダを自動で付与する。 */
  post(path: string, body?: PostBody, init?: RequestInit): Promise<Response>;
  /** 現在 jar に保持している Cookie ヘッダの値。 */
  cookieHeader(): string | undefined;
}

/**
 * cookie jar 付きの `app.request` ラッパを作る。
 * `post()` は CSRF 対策(Origin 検査)を通すため Origin ヘッダを自動で付ける。
 */
export function createTestClient(): TestClient {
  const jar = new Map<string, string>();

  function cookieHeader(): string | undefined {
    if (jar.size === 0) {
      return undefined;
    }
    return Array.from(jar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  function absorbSetCookies(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(";");
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((attr) => /^\s*max-age=0\s*$/i.test(attr));
      if (expired) {
        jar.delete(name);
      } else {
        jar.set(name, value);
      }
    }
  }

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookie = cookieHeader();
    if (cookie) {
      headers.set("cookie", cookie);
    }
    const response = await app.request(path, { ...init, headers }, env);
    absorbSetCookies(response);
    return response;
  }

  function get(path: string, init: RequestInit = {}): Promise<Response> {
    return request(path, { ...init, method: "GET" });
  }

  function post(
    path: string,
    body?: PostBody,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!headers.has("origin")) {
      headers.set("origin", ORIGIN);
    }
    let finalBody: BodyInit | undefined;
    if (
      body === undefined ||
      typeof body === "string" ||
      body instanceof URLSearchParams ||
      body instanceof FormData
    ) {
      finalBody = body;
    } else {
      finalBody = new URLSearchParams(body);
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/x-www-form-urlencoded");
      }
    }
    return request(path, { ...init, method: "POST", headers, body: finalBody });
  }

  return { request, get, post, cookieHeader };
}
