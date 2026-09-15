import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { errorResponse } from "../views/pages/error";

// このアプリのフォームは GET / POST のみを使う(PUT/DELETE は将来の拡張に
// 備えて含めているが未使用)。PATCH は想定していないため含めていない。
const UNSAFE_METHODS = new Set(["POST", "PUT", "DELETE"]);

/**
 * 診断ログに載せる User-Agent の長さの上限。一般的な UA は100〜150文字
 * 程度だが、Discord・LINE などのアプリ内ブラウザは末尾に独自の識別子
 * (`Discord/`, `Line/` 等)を付け足すため250〜300文字になることがある。
 * これはまさに今回切り分けたい情報(Fetch Metadata を送らないクライアント
 * の素性)なので、削れないよう長めに取る。
 */
const UA_LOG_MAX_LENGTH = 300;

/**
 * 診断ログに載せる `Sec-Fetch-Site` の長さの上限。サーバー側は
 * `same-origin` と一致するかしか見ておらず、既知の値の最長は
 * `same-origin`(11文字)。それ以外はクライアントが自由に送れる値なので、
 * ログを肥大化させる目的で長い値を送られないよう切り詰める。
 */
const SEC_FETCH_SITE_LOG_MAX_LENGTH = 40;

/**
 * ログに残してよい形にパスを丸める。`/e/{slug}/...` の slug は合言葉と
 * 同様に秘密情報なので、`/e/` の直後の1セグメントだけを `*` に置換する。
 * 呼び出し側はクエリ文字列を含まない値(`c.req.path`)を渡すこと。
 */
export function redactPath(path: string): string {
  return path.replace(/^\/e\/[^/]+/, "/e/*");
}

/**
 * `Origin` ヘッダの生値ではなく分類だけを返す。生値(実オリジン)自体は
 * ログに出さない方針(下記 console.warn 参照)のため。
 */
function classifyOrigin(origin: string | undefined, expected: string): string {
  if (origin === undefined) return "(absent)";
  if (origin === "") return "(empty)";
  if (origin === "null") return "null";
  return origin === expected ? "match" : "mismatch";
}

/** ログ用に文字列を先頭 `maxLength` 文字に切り詰める。無ければ `"(absent)"`。 */
function truncateForLog(value: string | undefined, maxLength: number): string {
  if (value === undefined) return "(absent)";
  return value.slice(0, maxLength);
}

/**
 * CSRF で 403 にする直前に、原因の切り分けに必要な情報だけを記録する。
 *
 * `[observability] enabled = true`(暫定的なデバッグ用、wrangler.toml
 * 参照)にしても invocation log に残るのは URL・メソッド・ステータスのみで、
 * どちらの分岐(Sec-Fetch-Site / Origin)で弾かれたか、原因となった
 * ヘッダの状態は分からない。特に User-Agent は「Fetch Metadata を送らない
 * 古いクライアント(iOS Safari 16.4 未満、Discord/LINE 等のアプリ内
 * ブラウザなど)が Sec-Fetch-Site 分岐で弾かれている」という仮説を判別する
 * 決定的な情報なので必ず含める。
 *
 * 逆に、slug の実値・cookie・合言葉や主催者キーなどの入力値・Origin の
 * 生文字列・完全な URL は記録しない(src/index.ts の onError と同じ方針)。
 * slug を含まないため、`enabled = false` に戻した後もこのログ自体は
 * `wrangler tail` で見え続けて害はない。
 */
function logRejection(c: Context<AppEnv>, reason: "sec-fetch-site" | "origin"): void {
  console.warn("csrf: rejected", {
    reason,
    method: c.req.method,
    path: redactPath(c.req.path),
    secFetchSite: truncateForLog(
      c.req.header("sec-fetch-site"),
      SEC_FETCH_SITE_LOG_MAX_LENGTH,
    ),
    origin: classifyOrigin(c.req.header("origin"), new URL(c.req.url).origin),
    ua: truncateForLog(c.req.header("user-agent"), UA_LOG_MAX_LENGTH),
  });
}

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
/**
 * Discord Interactions エンドポイントのみの完全一致の除外。Discord からの
 * リクエストには `Origin` も `Sec-Fetch-Site` も付かず、cookie も一切
 * 使わない(署名検証で送信元を保証する、`src/discord/verify.ts`)ため
 * CSRF の対象外にしてよい。前方一致ではなく完全一致にすることで、
 * 末尾スラッシュ違い(`/discord/interactions/`)など他のパスが誤って
 * 除外されないようにする。
 */
const DISCORD_INTERACTIONS_PATH = "/discord/interactions";

export const csrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.path === DISCORD_INTERACTIONS_PATH) {
    await next();
    return;
  }
  if (UNSAFE_METHODS.has(c.req.method)) {
    const secFetchSite = c.req.header("sec-fetch-site");
    if (secFetchSite !== undefined) {
      // Fetch Metadata が送られてきている場合はこちらを信頼する。
      // same-origin 以外(cross-site / same-site / none)はすべて拒否する。
      if (secFetchSite !== "same-origin") {
        logRejection(c, "sec-fetch-site");
        return errorResponse(c, 403, "不正なリクエストです");
      }
    } else {
      // フォールバック: Origin ヘッダの完全一致で判定する。
      // 欠落・"null"・不一致はすべて 403 とする。
      const origin = c.req.header("origin");
      const expected = new URL(c.req.url).origin;
      if (!origin || origin !== expected) {
        logRejection(c, "origin");
        return errorResponse(c, 403, "不正なリクエストです");
      }
    }
  }
  await next();
};
