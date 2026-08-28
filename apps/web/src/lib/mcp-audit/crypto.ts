// Symmetric encryption for LLM credentials at rest.
//
// Operators paste their own OpenAI/Anthropic keys into the audit config. Those are
// held server-side only (never returned to the client) and stored encrypted with
// AES-256-GCM under a deployment secret. This mirrors how the platform already
// treats owner tokens as server-only, but adds encryption because these are the
// operator's own provider credentials, not a TrustMCP-minted token.
//
// The key comes from AUDIT_ENCRYPTION_KEY (32-byte base64 or hex, or any string
// which is hashed to 32 bytes). If unset, we fall back to AUTH_SECRET/NEXTAUTH_SECRET
// so a standard deployment works without extra config, and refuse to store
// plaintext.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function keyBytes(): Buffer {
  const raw =
    process.env.AUDIT_ENCRYPTION_KEY ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    "";
  if (!raw) {
    throw new Error(
      "No encryption secret configured. Set AUDIT_ENCRYPTION_KEY (or AUTH_SECRET) to store model credentials.",
    );
  }
  // Normalize any secret to a stable 32-byte key.
  return createHash("sha256").update(raw).digest();
}

/** Encrypt plaintext → "v1:<iv b64>:<tag b64>:<ct b64>". */
export function encryptSecret(plaintext: string): string {
  const key = keyBytes();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/** Decrypt a value produced by encryptSecret. Throws on tamper/format error. */
export function decryptSecret(encoded: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed encrypted secret.");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const key = keyBytes();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}

/** Whether encryption is available on this deployment (for a config warning). */
export function encryptionConfigured(): boolean {
  return Boolean(
    process.env.AUDIT_ENCRYPTION_KEY ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  );
}

/** Show only the last 4 chars of a secret for the settings UI. */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) return "••••";
  return `••••${plaintext.slice(-4)}`;
}
