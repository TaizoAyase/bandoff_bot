/**
 * Discord の `/bandoff open` から届いたリンクの着地ページ
 * (`/e/:slug/discord`、計画5-2)。
 */

/**
 * `location.hash` からトークンを読み、すぐに `history.replaceState` で
 * URL から消してから(履歴・画面共有に残さないため)`POST` で消費する。
 * 成功したら応答 JSON の `redirect` へ遷移する。
 */
export async function initDiscordOpenPage(): Promise<void> {
  const root = document.querySelector("main");
  if (!(root instanceof HTMLElement)) {
    return;
  }
  const { slug } = root.dataset;
  if (!slug) {
    return;
  }

  const token = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  history.replaceState(null, "", location.pathname + location.search);

  if (!token) {
    showError();
    return;
  }

  try {
    const response = await fetch(`/e/${slug}/discord`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (response.ok) {
      const redirect = extractRedirect(await response.json());
      if (redirect && isEventRelativePath(redirect, slug)) {
        location.replace(redirect);
        return;
      }
    }
  } catch {
    // ネットワークエラーも下のエラー表示にまとめる。
  }
  showError();
}

function extractRedirect(data: unknown): string | null {
  if (
    typeof data === "object" &&
    data !== null &&
    "redirect" in data &&
    typeof (data as { redirect: unknown }).redirect === "string"
  ) {
    return (data as { redirect: string }).redirect;
  }
  return null;
}

/**
 * サーバーから返る `redirect` が、この slug のイベント配下を指す
 * 相対パスであることを確認する(計画5-2: クライアントでも検証する)。
 */
function isEventRelativePath(path: string, slug: string): boolean {
  return path.startsWith(`/e/${slug}/`);
}

function showError(): void {
  const errorEl = document.getElementById("discord-open-error");
  if (errorEl instanceof HTMLElement) {
    errorEl.hidden = false;
  }
}
