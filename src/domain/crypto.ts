/**
 * パスワードハッシュ・トークンハッシュ関連のユーティリティ。
 * WebCrypto のみを使い、Node 専用 API には依存しない。
 */

const PBKDF2_ITERATIONS = 20_000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_HASH_BYTES = 32; // SHA-256
const PBKDF2_ALGORITHM = "pbkdf2-sha256";

/**
 * パスワードを PBKDF2-SHA256 でハッシュ化する。
 * 保存形式: `pbkdf2-sha256$<iterations>$<saltBase64>$<hashBase64>`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const hash = await derivePbkdf2(password, salt, PBKDF2_ITERATIONS);
  return [
    PBKDF2_ALGORITHM,
    String(PBKDF2_ITERATIONS),
    encodeBase64(salt),
    encodeBase64(hash),
  ].join("$");
}

/**
 * パスワードを保存済みのハッシュ形式と照合する。
 * 保存値に記録された反復回数を使って再計算する(将来の引き上げに対応するため)。
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  if (!parsed) {
    return false;
  }
  const computed = await derivePbkdf2(password, parsed.salt, parsed.iterations);
  return timingSafeEqual(encodeBase64(computed), encodeBase64(parsed.hash));
}

function parseStoredHash(
  stored: string,
): { iterations: number; salt: Uint8Array; hash: Uint8Array } | null {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== PBKDF2_ALGORITHM) {
    return null;
  }
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    return null;
  }
  try {
    const salt = decodeBase64(parts[2] ?? "");
    const hash = decodeBase64(parts[3] ?? "");
    return { iterations, salt, hash };
  } catch {
    return null;
  }
}

async function derivePbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    PBKDF2_HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** 文字列の SHA-256 を16進文字列で返す(端末トークン・引き継ぎコードのハッシュ保存用)。 */
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

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
