import { afterEach, describe, expect, it } from 'vitest';
import {
  clearRegisteredSecrets,
  redactSecrets,
  registerSecret,
  safeErrorMessage,
} from '../src/core/security/redact.js';
import {
  looksLikeApiKey,
  maskSecret,
  safeEqual,
  secretFingerprint,
} from '../src/core/security/masking.js';

afterEach(() => {
  clearRegisteredSecrets();
});

describe('credential masking', () => {
  it('shows only the final four characters of a long key', () => {
    const secret = 'sk-proj-abcdefghijklmnop1234';
    const masked = maskSecret(secret);
    expect(masked).toBe('••••••••1234');
    expect(masked).not.toContain('abcdefghijklmnop');
  });

  it('fully masks short or missing values', () => {
    expect(maskSecret('short')).toBe('••••••••');
    expect(maskSecret('')).toBe('(not set)');
    expect(maskSecret(null)).toBe('(not set)');
  });

  it('produces a stable non-reversible fingerprint', () => {
    const fingerprint = secretFingerprint('super-secret-value');
    expect(fingerprint).toMatch(/^[0-9a-f]{10}$/);
    expect(fingerprint).toBe(secretFingerprint('super-secret-value'));
    expect(fingerprint).not.toBe(secretFingerprint('super-secret-valuf'));
    expect(secretFingerprint(null)).toBe('none');
  });

  it('compares values without leaking length mismatch details', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('rejects placeholders and whitespace as API keys', () => {
    expect(looksLikeApiKey('sk-proj-abcdefghijklmnop')).toBe(true);
    expect(looksLikeApiKey('short')).toBe(false);
    expect(looksLikeApiKey('has a space in it')).toBe(false);
    expect(looksLikeApiKey('your-api-key-here')).toBe(false);
  });
});

describe('secret redaction', () => {
  it('redacts registered values wherever they appear', () => {
    registerSecret('my-custom-secret-123456');
    const output = redactSecrets(
      'request failed for key my-custom-secret-123456 in header my-custom-secret-123456',
    );
    expect(output).not.toContain('my-custom-secret-123456');
    expect(output.match(/\[REDACTED\]/g)).toHaveLength(2);
  });

  it('ignores very short registered values', () => {
    registerSecret('abc');
    expect(redactSecrets('abc stays')).toBe('abc stays');
  });

  it('redacts common provider key shapes without registration', () => {
    const google = 'AIza' + 'A'.repeat(35);
    const openai = 'sk-proj-' + 'B'.repeat(24);
    const groq = 'gsk_' + 'C'.repeat(30);
    const github = 'ghp_' + 'D'.repeat(30);
    const output = redactSecrets(
      `google=${google} openai=${openai} groq=${groq} github=${github} Authorization: Bearer abcdefghijklmnopqrstuvwxyz`,
    );
    expect(output).not.toContain(google);
    expect(output).not.toContain(openai);
    expect(output).not.toContain(groq);
    expect(output).not.toContain(github);
    expect(output).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(output).toContain('[REDACTED_GOOGLE_KEY]');
    expect(output).toContain('[REDACTED_API_KEY]');
    expect(output).toContain('[REDACTED_GROQ_KEY]');
    expect(output).toContain('[REDACTED_GITHUB_TOKEN]');
  });

  it('redacts JSON credential fields and key=value pairs', () => {
    const output = redactSecrets(
      '{"apiKey":"abcdefghijklmnop","password":"hunter2hunter2"} api_key=1234567890abcdef',
    );
    expect(output).not.toContain('abcdefghijklmnop');
    expect(output).not.toContain('hunter2hunter2');
    expect(output).not.toContain('1234567890abcdef');
  });

  it('provides a safe message helper for unknown errors', () => {
    registerSecret('registered-secret-value');
    expect(safeErrorMessage(new Error('failed with registered-secret-value'))).toBe(
      'failed with [REDACTED]',
    );
    expect(safeErrorMessage('plain text')).toBe('plain text');
  });
});
