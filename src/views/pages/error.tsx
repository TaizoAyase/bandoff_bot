import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Layout } from "../layout";
import { renderPage } from "../render";

export interface ErrorPageProps {
  message: string;
  /** 「戻る」リンクの遷移先。既定は "/"。 */
  backHref?: string;
  /** 「戻る」リンクの文言。既定は "トップに戻る"。 */
  backLabel?: string;
}

/** 汎用エラーページ。ステータスやエラーの内部事情は文言に出さない。 */
export const ErrorPage = ({
  message,
  backHref = "/",
  backLabel = "トップに戻る",
}: ErrorPageProps) => (
  <Layout title="エラー" page="error">
    <main class="page">
      <h1>{message}</h1>
      <p>
        <a href={backHref}>{backLabel}</a>
      </p>
    </main>
  </Layout>
);

/** 汎用エラーページを指定ステータスで返す。 */
export function errorResponse(
  c: Context,
  status: ContentfulStatusCode,
  message: string,
  options?: { backHref?: string; backLabel?: string },
): Promise<Response> {
  return renderPage(
    c,
    <ErrorPage
      message={message}
      backHref={options?.backHref}
      backLabel={options?.backLabel}
    />,
    status,
  );
}

/**
 * 汎用の 404 応答。slug 不正・イベント不存在のいずれでも同じ文言を返し、
 * イベントの存在有無を外部から区別できないようにする。
 */
export function notFoundResponse(c: Context): Promise<Response> {
  return errorResponse(c, 404, "ページが見つかりません");
}
