import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getComicodeHome } from '../paths.js';
import { logger } from '../logger.js';
import { runProcess } from '../safety/process.js';
import { decryptString, encryptString, loadOrCreateMasterKey, writePrivateJson } from './crypto.js';

export type CredentialBackendId =
  | 'os-dpapi'
  | 'os-keychain'
  | 'os-secret-service'
  | 'encrypted-file'
  | 'environment';

export interface CredentialBackendDescription {
  id: CredentialBackendId;
  label: string;
  secure: boolean;
  detail: string;
}

interface SecretBackend {
  id: CredentialBackendId;
  label: string;
  available(): Promise<boolean>;
  get(id: string): Promise<string | null>;
  set(id: string, value: string): Promise<void>;
  delete(id: string): Promise<void>;
}

const INDEX_FILE = 'secrets.index.json';

function readIndex(): string[] {
  const path = join(getComicodeHome(), INDEX_FILE);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function addToIndex(id: string): void {
  const ids = new Set(readIndex());
  ids.add(id);
  writePrivateJson(join(getComicodeHome(), INDEX_FILE), [...ids].sort());
}

function removeFromIndex(id: string): void {
  const ids = readIndex().filter((entry) => entry !== id);
  writePrivateJson(join(getComicodeHome(), INDEX_FILE), ids);
}

class EncryptedFileBackend implements SecretBackend {
  id: CredentialBackendId = 'encrypted-file';
  label = 'Encrypted local file';

  private path = join(getComicodeHome(), 'credentials.enc.json');

  async available(): Promise<boolean> {
    return true;
  }

  private read(): Record<string, { v: 1; iv: string; tag: string; data: string }> {
    if (!existsSync(this.path)) return {};
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as Record<
        string,
        { v: 1; iv: string; tag: string; data: string }
      >;
    } catch (error) {
      throw new Error(
        `Credential store is unreadable (${this.path}). Run "comicode doctor" or remove it to reset credentials. ${String(
          error,
        )}`,
      );
    }
  }

  async get(id: string): Promise<string | null> {
    const blob = this.read()[id];
    if (!blob) return null;
    return decryptString(blob, loadOrCreateMasterKey());
  }

  async set(id: string, value: string): Promise<void> {
    const data = this.read();
    data[id] = encryptString(value, loadOrCreateMasterKey());
    writePrivateJson(this.path, data);
    addToIndex(id);
  }

  async delete(id: string): Promise<void> {
    const data = this.read();
    if (!(id in data)) return;
    delete data[id];
    writePrivateJson(this.path, data);
    removeFromIndex(id);
  }
}

/**
 * Windows DPAPI-backed storage: the blob is encrypted by the operating system
 * for the current user. The ciphertext lives in ComiCode's private app folder.
 */
class DpapiBackend implements SecretBackend {
  id: CredentialBackendId = 'os-dpapi';
  label = 'Windows DPAPI (current user)';

  private path = join(getComicodeHome(), 'credentials.dpapi.json');
  private availableCache: boolean | null = null;

  async available(): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    if (this.availableCache !== null) return this.availableCache;
    const probe = await this.transform('protect', Buffer.from('comicode-probe', 'utf8').toString('base64'));
    this.availableCache = probe !== null;
    return this.availableCache;
  }

  private async transform(mode: 'protect' | 'unprotect', base64: string): Promise<string | null> {
    const script =
      mode === 'protect'
        ? "Add-Type -AssemblyName System.Security; $b=[Console]::In.ReadToEnd().Trim(); " +
          "$x=[Convert]::FromBase64String($b); " +
          "$e=[System.Security.Cryptography.ProtectedData]::Protect($x,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); " +
          "[Console]::Out.Write([Convert]::ToBase64String($e))"
        : "Add-Type -AssemblyName System.Security; $b=[Console]::In.ReadToEnd().Trim(); " +
          "$x=[Convert]::FromBase64String($b); " +
          "$d=[System.Security.Cryptography.ProtectedData]::Unprotect($x,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); " +
          "[Console]::Out.Write([Convert]::ToBase64String($d))";
    const result = await runProcess(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { stdin: base64, timeoutMs: 20_000, maxOutputBytes: 128_000 },
    );
    if (result.spawnError || result.code !== 0 || result.timedOut) return null;
    return result.stdout.trim();
  }

  private read(): Record<string, string> {
    if (!existsSync(this.path)) return {};
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, string>;
    } catch {
      throw new Error(`DPAPI credential store is unreadable (${this.path}).`);
    }
  }

  async get(id: string): Promise<string | null> {
    const blob = this.read()[id];
    if (!blob) return null;
    const plain = await this.transform('unprotect', blob);
    return plain ? Buffer.from(plain, 'base64').toString('utf8') : null;
  }

  async set(id: string, value: string): Promise<void> {
    const encrypted = await this.transform(
      'protect',
      Buffer.from(value, 'utf8').toString('base64'),
    );
    if (!encrypted) throw new Error('Windows DPAPI encryption failed.');
    const data = this.read();
    data[id] = encrypted;
    writePrivateJson(this.path, data);
    addToIndex(id);
  }

  async delete(id: string): Promise<void> {
    const data = this.read();
    if (!(id in data)) return;
    delete data[id];
    writePrivateJson(this.path, data);
    removeFromIndex(id);
  }
}

class MacKeychainBackend implements SecretBackend {
  id: CredentialBackendId = 'os-keychain';
  label = 'macOS Keychain';
  private service = 'comicode';

  async available(): Promise<boolean> {
    if (process.platform !== 'darwin') return false;
    const result = await runProcess('security', ['-h'], { timeoutMs: 5000 });
    return !result.spawnError;
  }

  async get(id: string): Promise<string | null> {
    const result = await runProcess(
      'security',
      ['find-generic-password', '-s', this.service, '-a', id, '-w'],
      { timeoutMs: 10_000 },
    );
    if (result.spawnError || result.code !== 0) return null;
    return result.stdout.replace(/\r?\n$/, '');
  }

  async set(id: string, value: string): Promise<void> {
    const result = await runProcess(
      'security',
      ['add-generic-password', '-U', '-s', this.service, '-a', id, '-w', value],
      { timeoutMs: 10_000 },
    );
    if (result.spawnError || result.code !== 0) {
      throw new Error(`macOS Keychain write failed: ${result.stderr.trim() || 'unknown error'}`);
    }
    addToIndex(id);
  }

  async delete(id: string): Promise<void> {
    await runProcess('security', ['delete-generic-password', '-s', this.service, '-a', id], {
      timeoutMs: 10_000,
    });
    removeFromIndex(id);
  }
}

class SecretServiceBackend implements SecretBackend {
  id: CredentialBackendId = 'os-secret-service';
  label = 'Secret Service (libsecret)';
  private service = 'comicode';

  async available(): Promise<boolean> {
    if (process.platform !== 'linux') return false;
    const result = await runProcess('secret-tool', ['--version'], { timeoutMs: 5000 });
    return !result.spawnError;
  }

  async get(id: string): Promise<string | null> {
    const result = await runProcess(
      'secret-tool',
      ['lookup', 'service', this.service, 'account', id],
      { timeoutMs: 10_000 },
    );
    if (result.spawnError || result.code !== 0) return null;
    return result.stdout;
  }

  async set(id: string, value: string): Promise<void> {
    const result = await runProcess(
      'secret-tool',
      ['store', '--label', `ComiCode (${id})`, 'service', this.service, 'account', id],
      { stdin: value, timeoutMs: 10_000 },
    );
    if (result.spawnError || result.code !== 0) {
      throw new Error(`Secret Service write failed: ${result.stderr.trim() || 'unknown error'}`);
    }
    addToIndex(id);
  }

  async delete(id: string): Promise<void> {
    await runProcess('secret-tool', ['clear', 'service', this.service, 'account', id], {
      timeoutMs: 10_000,
    });
    removeFromIndex(id);
  }
}

class EnvironmentBackend implements SecretBackend {
  id: CredentialBackendId = 'environment';
  label = 'Environment variables';
  private map = new Map<string, string>();

  async available(): Promise<boolean> {
    return true;
  }

  private envName(id: string): string {
    return `COMICODE_SECRET_${id.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
  }

  async get(id: string): Promise<string | null> {
    const value = process.env[this.envName(id)] ?? this.map.get(id) ?? null;
    return value || null;
  }

  async set(id: string, value: string): Promise<void> {
    this.map.set(id, value);
    addToIndex(id);
  }

  async delete(id: string): Promise<void> {
    this.map.delete(id);
    removeFromIndex(id);
  }
}

export class CredentialStore {
  private backend: SecretBackend | null = null;
  private fallback: EncryptedFileBackend;
  private initialized = false;
  private forced: string | null;

  constructor(forcedBackend = process.env.COMICODE_CREDENTIAL_BACKEND ?? null) {
    this.forced = forcedBackend;
    this.fallback = new EncryptedFileBackend();
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const forced = this.forced?.toLowerCase();
    const osBackends: SecretBackend[] = [new DpapiBackend(), new MacKeychainBackend(), new SecretServiceBackend()];

    if (forced === 'file') {
      this.backend = this.fallback;
      return;
    }
    if (forced === 'env' || forced === 'environment') {
      this.backend = new EnvironmentBackend();
      return;
    }
    if (forced === 'os') {
      for (const backend of osBackends) {
        if (await backend.available()) {
          this.backend = backend;
          return;
        }
      }
      this.backend = this.fallback;
      return;
    }

    for (const backend of osBackends) {
      try {
        if (await backend.available()) {
          this.backend = backend;
          logger.info(`Using OS credential backend: ${backend.label}`);
          return;
        }
      } catch (error) {
        logger.debug(`Credential backend probe failed: ${String(error)}`);
      }
    }
    this.backend = this.fallback;
    logger.info('Using encrypted local credential fallback.');
  }

  async describe(): Promise<CredentialBackendDescription> {
    await this.init();
    const backend = this.backend ?? this.fallback;
    const secure = backend.id !== 'encrypted-file' || Boolean(process.env.COMICODE_MASTER_KEY);
    const detail =
      backend.id === 'encrypted-file'
        ? `${join(getComicodeHome(), 'credentials.enc.json')} (AES-256-GCM; key in master.key)`
        : backend.id === 'environment'
          ? 'Secrets read from COMICODE_SECRET_* environment variables'
          : 'Secrets are protected by the operating system credential facility';
    return {
      id: backend.id,
      label: backend.label,
      secure,
      detail,
    };
  }

  async getSecret(id: string): Promise<string | null> {
    await this.init();
    try {
      const value = await (this.backend ?? this.fallback).get(id);
      if (value !== null) return value;
      // Read through the encrypted fallback for migration/compatibility.
      if (this.backend && this.backend.id !== 'encrypted-file') {
        return await this.fallback.get(id);
      }
      return null;
    } catch (error) {
      logger.warn(`Credential read failed for ${id}: ${String(error)}`);
      return null;
    }
  }

  async setSecret(id: string, value: string): Promise<void> {
    await this.init();
    const trimmed = value.trim();
    if (!trimmed) throw new Error('Secret cannot be empty.');
    try {
      await (this.backend ?? this.fallback).set(id, trimmed);
    } catch (error) {
      logger.warn(`Credential backend write failed; using encrypted fallback. ${String(error)}`);
      this.backend = this.fallback;
      await this.fallback.set(id, trimmed);
    }
  }

  async deleteSecret(id: string): Promise<void> {
    await this.init();
    try {
      await (this.backend ?? this.fallback).delete(id);
    } catch (error) {
      logger.debug(`Credential backend delete failed: ${String(error)}`);
    }
    try {
      await this.fallback.delete(id);
    } catch {
      // Ignore missing fallback entries.
    }
    removeFromIndex(id);
  }

  listSecretIds(): string[] {
    return readIndex();
  }

  async deleteAllSecrets(): Promise<void> {
    const ids = new Set(readIndex());
    for (const id of ids) {
      await this.deleteSecret(id);
    }
  }
}

let singleton: CredentialStore | null = null;

export function getCredentialStore(): CredentialStore {
  if (!singleton) singleton = new CredentialStore();
  return singleton;
}

export function resetCredentialStoreForTests(): void {
  singleton = null;
}
