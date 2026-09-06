/**
 * ハッシュ・比較関連のユーティリティ。
 * WebCrypto のみを使い、Node 専用 API には依存しない。
 */

/** 文字列の SHA-256 を16進文字列で返す(端末トークン・引き継ぎコード・主催者キーのハッシュ保存用)。 */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** タイミング攻撃を避けるための定数時間比較。 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}
