import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Mask a credential for display. Never returns the full secret.
 * For secrets longer than 8 characters the final four characters are shown,
 * which is enough to distinguish profiles without exposing a usable key.
 */
export function maskSecret(secret: string | null | undefined): string {
  if (!secret) return '(not set)';
  const trimmed = secret.trim();
  if (trimmed.length === 0) return '(not set)';
  if (trimmed.length <= 8) return '••••••••';
  return `••••••••${trimmed.slice(-4)}`;
}

/** A short, non-reversible fingerprint useful for debugging without revealing a key. */
export function secretFingerprint(secret: string | null | undefined): string {
  if (!secret) return 'none';
  return createHash('sha256').update(secret).digest('hex').slice(0, 10);
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Whether a value looks like a plausible API key rather than a placeholder. */
export function looksLikeApiKey(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 12) return false;
  if (/\s/.test(trimmed)) return false;
  if (/^(your|my|replace|changeme|example|placeholder|xxx)/i.test(trimmed)) return false;
  return true;
}
