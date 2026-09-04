/**
 * welcome ページでの端末トークン・復帰キーの保存と、
 * 曲一覧ページでの端末トークンによる自動再結合(rebind)。
 */

import { clearToken, loadToken, saveRecoveryKey, saveToken } from "./storage";

/**
 * welcome ページ: `<main>` の `data-slug` / `data-token` / `data-recovery-key`
 * を localStorage へ保存し、「メモしました」チェックで「進む」ボタンを
 * 有効化する。「Discordに貼る文面」のコピーボタンも配線する。
 */
export function initWelcomePage(): void {
  const root = document.querySelector("main");
  if (root instanceof HTMLElement) {
    const { slug, token, recoveryKey } = root.dataset;
    if (slug && token && recoveryKey) {
      saveToken(slug, token);
      saveRecoveryKey(slug, recoveryKey);
    }
  }

  const checkbox = document.getElementById("memo-confirm");
  const continueButton = document.getElementById("continue-button");
  if (
    checkbox instanceof HTMLInputElement &&
    continueButton instanceof HTMLButtonElement
  ) {
    checkbox.addEventListener("change", () => {
      continueButton.disabled = !checkbox.checked;
    });
    continueButton.addEventListener("click", () => {
      if (continueButton.disabled) {
        return;
      }
      const href = continueButton.dataset.href;
      if (href) {
        location.href = href;
      }
    });
  }

  const copyButton = document.querySelector('[data-action="copy-paste-text"]');
  const pasteText = document.getElementById("paste-text");
  if (
    copyButton instanceof HTMLButtonElement &&
    pasteText instanceof HTMLTextAreaElement
  ) {
    copyButton.addEventListener("click", () => {
      navigator.clipboard?.writeText(pasteText.value).catch(() => {
        // クリップボード API が使えない場合は何もしない(テキストは選択して手動コピー可能)。
      });
    });
  }
}

/**
 * 曲一覧ページ: `<main data-participant="0">`(未登録)かつ
 * localStorage にトークンがあれば `/session/rebind` で再結合を試み、
 * 成功したらリロードする。失敗(401)ならトークンを破棄する。
 * sessionStorage のフラグで同一タブでの無限リロードを防ぐ。
 */
export async function tryRebind(): Promise<void> {
  const root = document.querySelector("main");
  if (!(root instanceof HTMLElement)) {
    return;
  }
  const { slug, participant } = root.dataset;
  if (!slug || participant !== "0") {
    return;
  }

  const attemptedKey = `bandoff:rebindAttempted:${slug}`;
  try {
    if (sessionStorage.getItem(attemptedKey)) {
      return;
    }
    sessionStorage.setItem(attemptedKey, "1");
  } catch {
    // sessionStorage が使えない環境ではループを防げないため試行しない。
    return;
  }

  const token = loadToken(slug);
  if (!token) {
    return;
  }

  try {
    const response = await fetch(`/e/${slug}/session/rebind`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (response.ok) {
      location.reload();
      return;
    }
    if (response.status === 401) {
      clearToken(slug);
    }
  } catch {
    // ネットワークエラーは無視する。
  }
}
