import { describe, expect, it } from "vitest";
import { isTimestampFresh, verifyDiscordSignature } from "../../src/discord/verify";

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** テスト用の Ed25519 鍵ペアを生成し、署名済みリクエストの材料一式を返す。 */
async function generateSignedRequest(
  timestamp: string,
  body: string,
): Promise<{
  publicKeyHex: string;
  signatureHex: string;
  timestamp: string;
  body: string;
}> {
  const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  // Workers の型定義には DOM 版のような "raw"/"jwk" によるオーバーロードの
  // 絞り込みが無く `ArrayBuffer | JsonWebKey` になるため、"raw" 指定時は
  // 常に ArrayBuffer であることをアサートする。
  const publicKeyBytes = (await crypto.subtle.exportKey(
    "raw",
    keyPair.publicKey,
  )) as ArrayBuffer;
  const message = new TextEncoder().encode(timestamp + body);
  const signatureBytes = await crypto.subtle.sign(
    { name: "Ed25519" },
    keyPair.privateKey,
    message,
  );
  return {
    publicKeyHex: bytesToHex(publicKeyBytes),
    signatureHex: bytesToHex(signatureBytes),
    timestamp,
    body,
  };
}

/** 16進文字列の1文字目を別の16進文字に変える(改ざん用)。 */
function flipFirstHexChar(hex: string): string {
  const replacement = hex[0] === "0" ? "1" : "0";
  return replacement + hex.slice(1);
}

describe("verifyDiscordSignature", () => {
  it("accepts a valid signature", async () => {
    const req = await generateSignedRequest("1700000000", '{"type":1}');
    const ok = await verifyDiscordSignature(
      req.publicKeyHex,
      req.signatureHex,
      req.timestamp,
      req.body,
    );
    expect(ok).toBe(true);
  });

  it("rejects when the body is tampered by one byte", async () => {
    const req = await generateSignedRequest("1700000000", '{"type":1}');
    const ok = await verifyDiscordSignature(
      req.publicKeyHex,
      req.signatureHex,
      req.timestamp,
      '{"type":2}',
    );
    expect(ok).toBe(false);
  });

  it("rejects when the timestamp is tampered by one byte", async () => {
    const req = await generateSignedRequest("1700000000", '{"type":1}');
    const ok = await verifyDiscordSignature(
      req.publicKeyHex,
      req.signatureHex,
      "1700000001",
      req.body,
    );
    expect(ok).toBe(false);
  });

  it("rejects when the signature is tampered by one byte", async () => {
    const req = await generateSignedRequest("1700000000", '{"type":1}');
    const ok = await verifyDiscordSignature(
      req.publicKeyHex,
      flipFirstHexChar(req.signatureHex),
      req.timestamp,
      req.body,
    );
    expect(ok).toBe(false);
  });

  it("rejects a signature from a different key pair", async () => {
    const req = await generateSignedRequest("1700000000", '{"type":1}');
    const other = await generateSignedRequest("1700000000", '{"type":1}');
    const ok = await verifyDiscordSignature(
      other.publicKeyHex,
      req.signatureHex,
      req.timestamp,
      req.body,
    );
    expect(ok).toBe(false);
  });

  it("rejects malformed hex for the signature", async () => {
    const req = await generateSignedRequest("1700000000", '{"type":1}');
    expect(
      await verifyDiscordSignature(
        req.publicKeyHex,
        "not-hex",
        req.timestamp,
        req.body,
      ),
    ).toBe(false);
    // 奇数長(バイト境界に合わない)。
    expect(
      await verifyDiscordSignature(
        req.publicKeyHex,
        req.signatureHex.slice(0, -1),
        req.timestamp,
        req.body,
      ),
    ).toBe(false);
  });

  it("rejects malformed hex / wrong length for the public key", async () => {
    const req = await generateSignedRequest("1700000000", '{"type":1}');
    expect(
      await verifyDiscordSignature(
        "not-hex",
        req.signatureHex,
        req.timestamp,
        req.body,
      ),
    ).toBe(false);
    expect(
      await verifyDiscordSignature(
        req.publicKeyHex.slice(0, -2), // 1バイト短い
        req.signatureHex,
        req.timestamp,
        req.body,
      ),
    ).toBe(false);
    expect(
      await verifyDiscordSignature(
        `${req.publicKeyHex}00`, // 1バイト長い
        req.signatureHex,
        req.timestamp,
        req.body,
      ),
    ).toBe(false);
  });

  it("rejects an empty public key or signature", async () => {
    const req = await generateSignedRequest("1700000000", '{"type":1}');
    expect(
      await verifyDiscordSignature("", req.signatureHex, req.timestamp, req.body),
    ).toBe(false);
    expect(
      await verifyDiscordSignature(req.publicKeyHex, "", req.timestamp, req.body),
    ).toBe(false);
  });
});

describe("isTimestampFresh", () => {
  it("accepts a timestamp equal to now", () => {
    expect(isTimestampFresh("1700000000", 1700000000)).toBe(true);
  });

  it("accepts the ±300 second boundary (inclusive)", () => {
    expect(isTimestampFresh("1700000000", 1700000300)).toBe(true);
    expect(isTimestampFresh("1700000300", 1700000000)).toBe(true);
  });

  it("rejects just past the ±300 second boundary", () => {
    expect(isTimestampFresh("1700000000", 1700000301)).toBe(false);
    expect(isTimestampFresh("1700000301", 1700000000)).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    expect(isTimestampFresh("not-a-number", 1700000000)).toBe(false);
    expect(isTimestampFresh("", 1700000000)).toBe(false);
    expect(isTimestampFresh("-1700000000", 1700000000)).toBe(false);
    expect(isTimestampFresh("1700000000.5", 1700000000)).toBe(false);
  });

  it("rejects a timestamp that is not a safe integer", () => {
    expect(isTimestampFresh("9".repeat(400), 1700000000)).toBe(false);
  });
});
