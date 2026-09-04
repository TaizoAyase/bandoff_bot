import type { FC, PropsWithChildren } from "hono/jsx";

export interface LayoutProps {
  title: string;
  /** クライアント側 main.ts が `document.body.dataset.page` で分岐するための識別子。 */
  page: string;
}

/**
 * 全ページ共通のレイアウト。
 * OGP メタは出さない(Discord のプロキシに情報を渡さないため)。
 * inline style / onclick / inline script は CSP により禁止。
 */
export const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  title,
  page,
  children,
}) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex" />
      <title>{title}</title>
      <link rel="stylesheet" href="/css/app.css" />
    </head>
    <body data-page={page}>
      {children}
      <script src="/js/main.js" />
    </body>
  </html>
);
