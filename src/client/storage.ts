/**
 * 端末トークン・引き継ぎコードの localStorage 操作。
 * イベント(slug)単位でキーを分ける。localStorage が使えない環境
 * (プライベートモード等)でも例外で処理を止めないよう、すべて try/catch する。
 */

function tokenKey(slug: string): string {
  return `bandoff:${slug}:token`;
}

function recoveryKeyKey(slug: string): string {
  return `bandoff:${slug}:recoveryKey`;
}

export function saveToken(slug: string, token: string): void {
  try {
    localStorage.setItem(tokenKey(slug), token);
  } catch {
    // localStorage が使えない環境では何もしない。
  }
}

export function loadToken(slug: string): string | null {
  try {
    return localStorage.getItem(tokenKey(slug));
  } catch {
    return null;
  }
}

export function clearToken(slug: string): void {
  try {
    localStorage.removeItem(tokenKey(slug));
  } catch {
    // no-op
  }
}

export function saveRecoveryKey(slug: string, recoveryKey: string): void {
  try {
    localStorage.setItem(recoveryKeyKey(slug), recoveryKey);
  } catch {
    // no-op
  }
}

export function loadRecoveryKey(slug: string): string | null {
  try {
    return localStorage.getItem(recoveryKeyKey(slug));
  } catch {
    return null;
  }
}

export function clearRecoveryKey(slug: string): void {
  try {
    localStorage.removeItem(recoveryKeyKey(slug));
  } catch {
    // no-op
  }
}
