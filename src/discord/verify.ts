/**
 * Discord Interactions のリクエスト署名検証(計画4-2)。
 * 依存パッケージは追加せず WebCrypto のみで実装する。workerd は
 * `crypto.subtle.{importKey,verify}` のアルゴリズム名として `"Ed25519"` を
 * そのまま受け付ける(`NODE-ED25519` への読み替えは不要。
 * `test/discord/verify.test.ts` で確認済み)。
 */

const HEX_PATTERN = /^[0-9a-f]+$/i;
const PUBLIC_KEY_BYTES = 32;
const SIGNATURE_BYTES = 64;

/** リプレイ対策のタイムスタンプ許容幅(秒)。 */
const TIMESTAMP_TOLERANCE_SECONDS = 300;

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !HEX_PATTERN.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * `X-Signature-Ed25519` / `X-Signature-Timestamp` と生の本文文字列から
 * Discord の Ed25519 署名を検証する。公開鍵・署名の形式不正、鍵の import
 * 失敗、署名不一致はすべて `false`(呼び出し側で 401 として扱う)。
 * 例外を外に投げない(呼び出し側のログにヘッダ・本文の値が漏れないように
 * するため、失敗理由を握りつぶして bool にする)。
 */
export async function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  body: string,
): Promise<boolean> {
  const publicKeyBytes = hexToBytes(publicKeyHex);
  if (!publicKeyBytes || publicKeyBytes.length !== PUBLIC_KEY_BYTES) {
    return false;
  }
  const signatureBytes = hexToBytes(signatureHex);
  if (!signatureBytes || signatureBytes.length !== SIGNATURE_BYTES) {
    return false;
  }

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch {
    return false;
  }

  const message = new TextEncoder().encode(timestamp + body);
  try {
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signatureBytes,
      message,
    );
  } catch {
    return false;
  }
}

const TIMESTAMP_PATTERN = /^\d+$/;

/**
 * `X-Signature-Timestamp` が現在時刻から ±300秒以内かを確認する
 * (リプレイ対策、計画4-2)。形式不正・数値化できない場合は `false`。
 */
export function isTimestampFresh(timestampHeader: string, nowSeconds: number): boolean {
  if (!TIMESTAMP_PATTERN.test(timestampHeader)) {
    return false;
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isSafeInteger(timestamp)) {
    return false;
  }
  return Math.abs(nowSeconds - timestamp) <= TIMESTAMP_TOLERANCE_SECONDS;
}
