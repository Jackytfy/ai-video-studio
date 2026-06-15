/**
 * Symmetric encryption helpers for user-stored secrets (API keys, tokens).
 *
 * Algorithm: AES-256-GCM (authenticated encryption).
 * - 32-byte key, base64-encoded, sourced from `API_KEY_ENCRYPTION_KEY`.
 * - 12-byte random IV per encryption.
 * - Output format: base64(iv || ciphertext || authTag) — single string, no extra metadata.
 *
 * Design notes:
 * - The encrypted blob is self-describing; we do not store IV/tag separately.
 * - `decrypt` returns `null` for malformed input — callers should treat this as
 *   "no usable key" and fall back to env vars.
 * - If `API_KEY_ENCRYPTION_KEY` is missing, all helpers log a warning and return
 *   plaintext (legacy mode) so the app does not crash. This is intentionally loud
 *   so it shows up in deployment logs.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;

function getKey(): Buffer | null {
  const raw = process.env.API_KEY_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[crypto] API_KEY_ENCRYPTION_KEY is not set — secrets will be stored as plaintext. " +
          "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
      );
    }
    return null;
  }
  try {
    // Accept either base64 or hex (auto-detect by length). Fall back to SHA-256
    // of the raw string so user-supplied passphrases still produce a 32-byte key.
    let key: Buffer;
    if (raw.length === 44 && raw.endsWith("=")) {
      key = Buffer.from(raw, "base64");
    } else if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
      key = Buffer.from(raw, "hex");
    } else {
      key = createHash("sha256").update(raw).digest();
    }
    return key.length === KEY_LEN ? key : null;
  } catch {
    return null;
  }
}

/**
 * Encrypt a plaintext string. Returns a base64 string containing
 * `iv (12) || ciphertext (n) || authTag (16)`.
 *
 * If no encryption key is configured, returns the plaintext unchanged
 * (with a warning logged in production).
 */
export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === "") return null;
  const key = getKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString("base64");
}

/**
 * Decrypt a base64 blob produced by `encryptSecret`. Returns the plaintext,
 * or `null` if the input is invalid, the auth tag fails to verify, or no
 * key is configured and the input is not plaintext.
 */
export function decryptSecret(blob: string | null | undefined): string | null {
  if (blob == null || blob === "") return null;
  const key = getKey();
  if (!key) {
    // Legacy mode: assume the value is plaintext.
    return blob;
  }

  let raw: Buffer;
  try {
    raw = Buffer.from(blob, "base64");
  } catch {
    return null;
  }
  // Must contain at least IV + tag.
  if (raw.length < IV_LEN + 16) return null;

  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(raw.length - 16);
  const ciphertext = raw.subarray(IV_LEN, raw.length - 16);

  try {
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Auth tag mismatch — corrupted key or tampered value.
    return null;
  }
}

/**
 * Return a short fingerprint of a secret for display in the UI, e.g.
 *   "sk-…7Hk2"   →   "sk-****-****-****-7Hk2"
 *
 * Never returns the full secret. Used by /api/user/settings to show
 * "you have a key configured" without revealing it.
 */
export function maskSecret(blob: string | null | undefined): string | null {
  if (blob == null || blob === "") return null;
  const plain = decryptSecret(blob);
  if (plain == null) return null;
  if (plain.length <= 8) return "****";
  const head = plain.slice(0, 3);
  const tail = plain.slice(-4);
  return `${head}…${tail}`;
}
