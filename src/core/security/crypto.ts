import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getComicodeHome } from '../paths.js';
import { logger } from '../logger.js';

export interface CipherBlob {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

export function generateMasterKey(): string {
  return randomBytes(32).toString('base64');
}

function decodeKey(key: string): Buffer {
  const buffer = Buffer.from(key, 'base64');
  if (buffer.length !== 32) {
    throw new Error('Invalid ComiCode master key: expected 32 bytes of base64 data.');
  }
  return buffer;
}

export function encryptString(plaintext: string, keyBase64: string): CipherBlob {
  const key = decodeKey(keyBase64);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function decryptString(blob: CipherBlob, keyBase64: string): string {
  if (blob.v !== 1) throw new Error('Unsupported credential format version.');
  const key = decodeKey(keyBase64);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(blob.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function getMasterKeyPath(): string {
  return join(getComicodeHome(), 'master.key');
}

/**
 * Load the local encryption key. `COMICODE_MASTER_KEY` may provide a key
 * directly (useful for CI or managed environments). Otherwise a random key is
 * created once with restrictive file permissions.
 */
export function loadOrCreateMasterKey(): string {
  const fromEnv = process.env.COMICODE_MASTER_KEY?.trim();
  if (fromEnv) {
    decodeKey(fromEnv);
    return fromEnv;
  }

  const path = getMasterKeyPath();
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8').trim();
    decodeKey(existing);
    return existing;
  }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const key = generateMasterKey();
  writeFileSync(path, key, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows ACL hardening is handled by the credential store.
  }
  logger.info('Created local encryption key for credential fallback store.');
  return key;
}

/** Atomically replace a JSON file with restrictive permissions. */
export function writePrivateJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(temp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort on platforms without POSIX permissions.
  }
}
