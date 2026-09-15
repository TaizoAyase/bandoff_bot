/**
 * welcome ページでの端末トークン・引き継ぎコード・主催者キーの保存、
 * 主催者ログイン直後ページでの主催者キーの保存、
 * 曲一覧ページでの端末トークンによる自動再結合(rebind)。
 */

import {
  clearRecoveryKey,
  clearToken,
  loadToken,
  saveOrganizerKey,
  saveRecoveryKey,
  saveToken,
} from "./storage";

/**
 * welcome ページ: `<main>` の `data-slug` / `data-token` / `data-recovery-key` /
 * `data-organizer-key`(あれば)を localStorage へ保存し、「メモしました」
 * チェックで「進む」ボタンを有効化する。コピーボタンの配線は
 * `src/client/ui.ts` の `initCopyButtons()` が担当する(主催者画面・設定画面と共有)。
 */
export function initWelcomePage(): void {
  const root = document.querySelector("main");
  if (root instanceof HTMLElement) {
    const { slug, token, recoveryKey, organizerKey } = root.dataset;
    if (slug && token && recoveryKey) {
      saveToken(slug, token);
      saveRecoveryKey(slug, recoveryKey);
    }
    if (slug && organizerKey) {
      saveOrganizerKey(slug, organizerKey);
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

/**
 * 参加取りやめ完了ページ: `<main>` の `data-slug` を読み、端末トークンと
 * 引き継ぎコードを localStorage から消す(主催者キーは消さない。
 * 共同主催者の主催者権限は端末の紐付けとは別物のため)。
 *
 * フォームの submit イベントではなく、この完了ページの**表示**をトリガーに
 * 消す(計画5-1)。理由は2つ: (1) `data-confirm` の確認ダイアログは
 * document への委譲なので、フォームに直接付けた submit リスナーは
 * キャンセルより先に走ってしまい、キャンセルしても消えてしまう。
 * (2) `GET ...?withdrawn=1` のような目印にすると、そのリンクを他人に
 * 踏ませるだけで端末の引き継ぎコードを消せてしまう。POST の応答である
 * この画面の表示なら CSRF 対策の内側に収まる。
 */
export function initWithdrawnPage(): void {
  const root = document.querySelector("main");
  if (!(root instanceof HTMLElement)) {
    return;
  }
  const { slug } = root.dataset;
  if (!slug) {
    return;
  }
  clearToken(slug);
  clearRecoveryKey(slug);
}

/**
 * 主催者ログイン直後ページ: `<main>` の `data-slug` / `data-organizer-key` を
 * 読み、主催者キーを localStorage に保存してから主催者画面へ遷移する。
 * JS が動かない環境ではページ内のリンクから進む。
 */
export function initOrganizerLoginDone(): void {
  const root = document.querySelector("main");
  if (!(root instanceof HTMLElement)) {
    return;
  }
  const { slug, organizerKey } = root.dataset;
  if (!slug) {
    return;
  }
  if (organizerKey) {
    saveOrganizerKey(slug, organizerKey);
  }
  location.replace(`/e/${slug}/organizer`);
}
