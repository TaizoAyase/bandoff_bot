/**
 * ID・トークン類の生成と検証。すべて暗号論的乱数(WebCrypto)を使う。
 */

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"; // Base32 小文字
const SLUG_LENGTH = 26; // 128bit を 5bit ずつ = 26文字(ceil(128/5))
const SLUG_PATTERN = /^[a-z2-7]{26}$/;

const RECOVERY_KEY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // I/O/0/1 なし
const RECOVERY_KEY_GROUP_LENGTH = 4;
const RECOVERY_KEY_GROUPS = 3;

/** UUID v4 の新規 id を生成する。 */
export function newId(): string {
  return crypto.randomUUID();
}

/**
 * イベントの slug を生成する。128bit の乱数を Base32(小文字)で
 * エンコードした26文字(`^[a-z2-7]{26}$`)。
 */
export function newSlug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); // 128bit
  // 16バイト(128bit)入力なら encodeBase32 は常にちょうど26文字を返すため
  // 本来 no-op だが、入力バイト数やアルファベットを変更したときに長さが
  // ずれても SLUG_PATTERN の形式を保つための防御的な slice。
  return encodeBase32(bytes, SLUG_ALPHABET).slice(0, SLUG_LENGTH);
}

/** slug の形式が正しいかを検証する(DB を引く前のバリデーション用)。 */
export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

/**
 * 端末トークンを生成する。256bit の乱数を base64url でエンコードする。
 * 平文は localStorage にのみ保存し、DB にはハッシュのみを保存する。
 */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32)); // 256bit
  return encodeBase64Url(bytes);
}

/**
 * 引き継ぎコードを生成する。誤読しにくい32文字セット(Base32 から I/O/0/1 を除去)で
 * `XXXX-XXXX-XXXX` 形式(60bit)。
 */
export function newRecoveryKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => RECOVERY_KEY_ALPHABET[b & 31]);
  const groups: string[] = [];
  for (let i = 0; i < RECOVERY_KEY_GROUPS; i++) {
    const start = i * RECOVERY_KEY_GROUP_LENGTH;
    groups.push(chars.slice(start, start + RECOVERY_KEY_GROUP_LENGTH).join(""));
  }
  return groups.join("-");
}

/**
 * 引き継ぎコード入力を照合用に正規化する。大文字化し、ハイフンと空白を除去する。
 */
export function normalizeRecoveryKey(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

function encodeBase32(bytes: Uint8Array, alphabet: string): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
