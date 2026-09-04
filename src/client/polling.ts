/**
 * 曲一覧の非アクティブタブ停止つきポーリング(仕様 9.4)。
 * `#song-list` の中身を `/e/:slug/fragments/songs` の HTML 断片で差し替える。
 */

const POLL_INTERVAL_MS = 5000;

/** 曲一覧ページでポーリングを開始する。 */
export function startPolling(slug: string): void {
  const maybeContainer = document.getElementById("song-list");
  if (!maybeContainer) {
    return;
  }
  const container: HTMLElement = maybeContainer;

  let lastHtml: string | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  async function fetchAndApply(): Promise<void> {
    if (stopped || document.hidden) {
      return;
    }
    if (container.contains(document.activeElement)) {
      // 操作中(ボタンやフォーム内にフォーカスがある)は差し替えない。
      return;
    }
    let response: Response;
    try {
      response = await fetch(`/e/${slug}/fragments/songs`, {
        credentials: "same-origin",
      });
    } catch {
      // ネットワークエラーは無視して次の周期に任せる。
      return;
    }
    if (response.status === 401 || response.status === 403) {
      stopped = true;
      stopTimer();
      return;
    }
    if (!response.ok) {
      return;
    }
    const html = await response.text();
    if (html === lastHtml) {
      return;
    }
    lastHtml = html;
    container.innerHTML = html;
  }

  function startTimer(): void {
    if (timer !== undefined) {
      return;
    }
    timer = setInterval(() => {
      void fetchAndApply();
    }, POLL_INTERVAL_MS);
  }

  function stopTimer(): void {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  function handleVisible(): void {
    if (stopped) {
      return;
    }
    if (document.hidden) {
      stopTimer();
    } else {
      // 復帰時は即座に1回フェッチしてからインターバルを再開する。
      void fetchAndApply();
      startTimer();
    }
  }

  document.addEventListener("visibilitychange", handleVisible);
  // モバイルSafari 等でアプリ切り替え時に visibilitychange の代わりに
  // pagehide/pageshow が発火することがあるため、両方拾う。
  // beforeunload は bfcache を無効化するため使わない。
  window.addEventListener("pagehide", stopTimer);
  window.addEventListener("pageshow", handleVisible);

  if (!document.hidden) {
    void fetchAndApply();
    startTimer();
  }
}
