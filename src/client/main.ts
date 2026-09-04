/**
 * クライアント側エントリポイント。`document.body.dataset.page` の値で
 * ページごとの初期化処理に分岐する。
 */

import { startPolling } from "./polling";
import { initWelcomePage, tryRebind } from "./session";
import { initSongForm } from "./ui";

const page = document.body.dataset.page;

switch (page) {
  case "welcome":
    initWelcomePage();
    break;
  case "song-list": {
    const root = document.querySelector("main");
    const slug = root instanceof HTMLElement ? root.dataset.slug : undefined;
    if (slug) {
      void tryRebind();
      startPolling(slug);
    }
    break;
  }
  case "song-form":
    initSongForm();
    break;
  default:
    break;
}
