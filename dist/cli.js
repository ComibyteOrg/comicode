#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/version.ts
var VERSION, GITHUB_REPOSITORY;
var init_version = __esm({
  "src/version.ts"() {
    "use strict";
    VERSION = true ? "0.1.1" : "0.1.0-dev";
    GITHUB_REPOSITORY = "https://github.com/ComibyteOrg/comicode";
  }
});

// src/core/paths.ts
import { homedir } from "os";
import { join, resolve } from "path";
import { mkdirSync } from "fs";
function getComicodeHome() {
  const override = process.env.COMICODE_HOME?.trim();
  if (override) return resolve(override);
  if (process.platform === "win32") {
    const base = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(base, "comicode");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "comicode");
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && xdg.trim() ? xdg : join(homedir(), ".config"), "comicode");
}
function ensureComicodeHome() {
  const home = getComicodeHome();
  mkdirSync(home, { recursive: true, mode: 448 });
  mkdirSync(join(home, "logs"), { recursive: true, mode: 448 });
  return home;
}
function getDatabasePath() {
  const override = process.env.COMICODE_DB_PATH?.trim();
  return override ? resolve(override) : join(getComicodeHome(), "comicode.db");
}
function getLogPath() {
  return join(getComicodeHome(), "logs", "comicode.log");
}
function getProjectStateDir(cwd) {
  return join(cwd, ".comicode");
}
function getProjectStatePath(cwd) {
  return join(getProjectStateDir(cwd), "project.json");
}
var init_paths = __esm({
  "src/core/paths.ts"() {
    "use strict";
  }
});

// src/core/security/redact.ts
function registerSecret(value) {
  if (!value || value.length < 8) return;
  knownSecrets.add(value);
  if (knownSecrets.size > 200) {
    const oldest = knownSecrets.values().next().value;
    if (oldest) knownSecrets.delete(oldest);
  }
}
function redactSecrets(text) {
  if (!text) return text;
  let output = text;
  for (const secret of knownSecrets) {
    if (output.includes(secret)) {
      output = output.split(secret).join("[REDACTED]");
    }
  }
  for (const [pattern, replacement] of PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}
function safeErrorMessage(error) {
  if (error instanceof Error) return redactSecrets(error.message);
  return redactSecrets(String(error));
}
var knownSecrets, PATTERNS;
var init_redact = __esm({
  "src/core/security/redact.ts"() {
    "use strict";
    knownSecrets = /* @__PURE__ */ new Set();
    PATTERNS = [
      [/\bAIza[0-9A-Za-z_-]{35}\b/g, "[REDACTED_GOOGLE_KEY]"],
      [/\b(sk-or-v1|sk-proj|sk-ant|sk)-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_API_KEY]"],
      [/\bgsk_[A-Za-z0-9]{20,}\b/g, "[REDACTED_GROQ_KEY]"],
      [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]"],
      [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_SLACK_TOKEN]"],
      [/\b(Bearer|Token)\s+[A-Za-z0-9._~+/-]{16,}=*/gi, "$1 [REDACTED]"],
      [
        /("(?:api[_-]?key|apiKey|authorization|password|secret|token)"\s*:\s*")([^"]{8,})(")/gi,
        "$1[REDACTED]$3"
      ],
      [
        /((?:api[_-]?key|apiKey|authorization|password|secret|token)\s*[=:]\s*)([^\s,;"']{8,})/gi,
        "$1[REDACTED]"
      ]
    ];
  }
});

// src/core/logger.ts
import { appendFileSync, existsSync, mkdirSync as mkdirSync2, renameSync, statSync, unlinkSync } from "fs";
import { dirname } from "path";
function configuredLevel() {
  const raw = (process.env.COMICODE_LOG_LEVEL || "info").toLowerCase();
  return raw in LEVELS ? raw : "info";
}
function rotateIfNeeded(path, maxBytes = 2 * 1024 * 1024) {
  try {
    if (existsSync(path) && statSync(path).size > maxBytes) {
      const archived = `${path}.1`;
      if (existsSync(archived)) unlinkSync(archived);
      renameSync(path, archived);
    }
  } catch {
  }
}
function write(level, message, meta) {
  if (LEVELS[level] < LEVELS[configuredLevel()]) return;
  try {
    const path = getLogPath();
    mkdirSync2(dirname(path), { recursive: true, mode: 448 });
    rotateIfNeeded(path);
    const line = JSON.stringify({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      msg: redactSecrets(message),
      ...meta ? { meta: JSON.parse(redactSecrets(JSON.stringify(meta))) } : {}
    });
    appendFileSync(path, `${line}
`, { mode: 384 });
  } catch {
  }
}
var LEVELS, logger;
var init_logger = __esm({
  "src/core/logger.ts"() {
    "use strict";
    init_paths();
    init_redact();
    LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
    logger = {
      debug: (message, meta) => write("debug", message, meta),
      info: (message, meta) => write("info", message, meta),
      warn: (message, meta) => write("warn", message, meta),
      error: (message, meta) => write("error", message, meta)
    };
  }
});

// src/core/safety/process.ts
import { spawn } from "child_process";
function runProcess(command, args, options = {}) {
  const { cwd, env, timeoutMs = 15e3, maxOutputBytes = 256e3, stdin: stdin3, signal } = options;
  return new Promise((resolve6) => {
    let settled = false;
    let stdout3 = "";
    let stderr = "";
    let timedOut = false;
    let spawnError = null;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve6({ code, stdout: stdout3, stderr, timedOut, spawnError });
    };
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: env ?? process.env,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      spawnError = error instanceof Error ? error.message : String(error);
      resolve6({ code: null, stdout: "", stderr: "", timedOut: false, spawnError });
      return;
    }
    const timer = setTimeout(
      () => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!settled) child.kill("SIGKILL");
        }, 1500).unref();
      },
      Math.max(100, timeoutMs)
    );
    const abort = () => {
      timedOut = true;
      child.kill("SIGTERM");
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", (chunk) => {
      if (stdout3.length < maxOutputBytes) stdout3 += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < maxOutputBytes) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      spawnError = error.message;
      finish(null);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      finish(code);
    });
    if (stdin3 !== void 0 && child.stdin) {
      child.stdin.end(stdin3);
    } else if (child.stdin) {
      child.stdin.end();
    }
  });
}
var init_process = __esm({
  "src/core/safety/process.ts"() {
    "use strict";
  }
});

// src/core/security/crypto.ts
import { chmodSync, existsSync as existsSync2, mkdirSync as mkdirSync3, readFileSync, renameSync as renameSync2, writeFileSync } from "fs";
import { dirname as dirname2, join as join2 } from "path";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
function generateMasterKey() {
  return randomBytes(32).toString("base64");
}
function decodeKey(key) {
  const buffer = Buffer.from(key, "base64");
  if (buffer.length !== 32) {
    throw new Error("Invalid ComiCode master key: expected 32 bytes of base64 data.");
  }
  return buffer;
}
function encryptString(plaintext, keyBase64) {
  const key = decodeKey(keyBase64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64")
  };
}
function decryptString(blob, keyBase64) {
  if (blob.v !== 1) throw new Error("Unsupported credential format version.");
  const key = decodeKey(keyBase64);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(blob.data, "base64")),
    decipher.final()
  ]).toString("utf8");
}
function getMasterKeyPath() {
  return join2(getComicodeHome(), "master.key");
}
function loadOrCreateMasterKey() {
  const fromEnv = process.env.COMICODE_MASTER_KEY?.trim();
  if (fromEnv) {
    decodeKey(fromEnv);
    return fromEnv;
  }
  const path = getMasterKeyPath();
  if (existsSync2(path)) {
    const existing = readFileSync(path, "utf8").trim();
    decodeKey(existing);
    return existing;
  }
  mkdirSync3(dirname2(path), { recursive: true, mode: 448 });
  const key = generateMasterKey();
  writeFileSync(path, key, { mode: 384 });
  try {
    chmodSync(path, 384);
  } catch {
  }
  logger.info("Created local encryption key for credential fallback store.");
  return key;
}
function writePrivateJson(path, value) {
  mkdirSync3(dirname2(path), { recursive: true, mode: 448 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 384 });
  renameSync2(temp, path);
  try {
    chmodSync(path, 384);
  } catch {
  }
}
var init_crypto = __esm({
  "src/core/security/crypto.ts"() {
    "use strict";
    init_paths();
    init_logger();
  }
});

// src/core/security/credentials.ts
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "fs";
import { join as join3 } from "path";
function readIndex() {
  const path = join3(getComicodeHome(), INDEX_FILE);
  if (!existsSync3(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync2(path, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
function addToIndex(id) {
  const ids = new Set(readIndex());
  ids.add(id);
  writePrivateJson(join3(getComicodeHome(), INDEX_FILE), [...ids].sort());
}
function removeFromIndex(id) {
  const ids = readIndex().filter((entry) => entry !== id);
  writePrivateJson(join3(getComicodeHome(), INDEX_FILE), ids);
}
function getCredentialStore() {
  if (!singleton) singleton = new CredentialStore();
  return singleton;
}
var INDEX_FILE, EncryptedFileBackend, DpapiBackend, MacKeychainBackend, SecretServiceBackend, EnvironmentBackend, CredentialStore, singleton;
var init_credentials = __esm({
  "src/core/security/credentials.ts"() {
    "use strict";
    init_paths();
    init_logger();
    init_process();
    init_crypto();
    INDEX_FILE = "secrets.index.json";
    EncryptedFileBackend = class {
      id = "encrypted-file";
      label = "Encrypted local file";
      path = join3(getComicodeHome(), "credentials.enc.json");
      async available() {
        return true;
      }
      read() {
        if (!existsSync3(this.path)) return {};
        try {
          return JSON.parse(readFileSync2(this.path, "utf8"));
        } catch (error) {
          throw new Error(
            `Credential store is unreadable (${this.path}). Run "comicode doctor" or remove it to reset credentials. ${String(
              error
            )}`
          );
        }
      }
      async get(id) {
        const blob = this.read()[id];
        if (!blob) return null;
        return decryptString(blob, loadOrCreateMasterKey());
      }
      async set(id, value) {
        const data = this.read();
        data[id] = encryptString(value, loadOrCreateMasterKey());
        writePrivateJson(this.path, data);
        addToIndex(id);
      }
      async delete(id) {
        const data = this.read();
        if (!(id in data)) return;
        delete data[id];
        writePrivateJson(this.path, data);
        removeFromIndex(id);
      }
    };
    DpapiBackend = class {
      id = "os-dpapi";
      label = "Windows DPAPI (current user)";
      path = join3(getComicodeHome(), "credentials.dpapi.json");
      availableCache = null;
      async available() {
        if (process.platform !== "win32") return false;
        if (this.availableCache !== null) return this.availableCache;
        const probe = await this.transform("protect", Buffer.from("comicode-probe", "utf8").toString("base64"));
        this.availableCache = probe !== null;
        return this.availableCache;
      }
      async transform(mode, base64) {
        const script = mode === "protect" ? "Add-Type -AssemblyName System.Security; $b=[Console]::In.ReadToEnd().Trim(); $x=[Convert]::FromBase64String($b); $e=[System.Security.Cryptography.ProtectedData]::Protect($x,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($e))" : "Add-Type -AssemblyName System.Security; $b=[Console]::In.ReadToEnd().Trim(); $x=[Convert]::FromBase64String($b); $d=[System.Security.Cryptography.ProtectedData]::Unprotect($x,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($d))";
        const result = await runProcess(
          "powershell.exe",
          ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
          { stdin: base64, timeoutMs: 2e4, maxOutputBytes: 128e3 }
        );
        if (result.spawnError || result.code !== 0 || result.timedOut) return null;
        return result.stdout.trim();
      }
      read() {
        if (!existsSync3(this.path)) return {};
        try {
          return JSON.parse(readFileSync2(this.path, "utf8"));
        } catch {
          throw new Error(`DPAPI credential store is unreadable (${this.path}).`);
        }
      }
      async get(id) {
        const blob = this.read()[id];
        if (!blob) return null;
        const plain = await this.transform("unprotect", blob);
        return plain ? Buffer.from(plain, "base64").toString("utf8") : null;
      }
      async set(id, value) {
        const encrypted = await this.transform(
          "protect",
          Buffer.from(value, "utf8").toString("base64")
        );
        if (!encrypted) throw new Error("Windows DPAPI encryption failed.");
        const data = this.read();
        data[id] = encrypted;
        writePrivateJson(this.path, data);
        addToIndex(id);
      }
      async delete(id) {
        const data = this.read();
        if (!(id in data)) return;
        delete data[id];
        writePrivateJson(this.path, data);
        removeFromIndex(id);
      }
    };
    MacKeychainBackend = class {
      id = "os-keychain";
      label = "macOS Keychain";
      service = "comicode";
      async available() {
        if (process.platform !== "darwin") return false;
        const result = await runProcess("security", ["-h"], { timeoutMs: 5e3 });
        return !result.spawnError;
      }
      async get(id) {
        const result = await runProcess(
          "security",
          ["find-generic-password", "-s", this.service, "-a", id, "-w"],
          { timeoutMs: 1e4 }
        );
        if (result.spawnError || result.code !== 0) return null;
        return result.stdout.replace(/\r?\n$/, "");
      }
      async set(id, value) {
        const result = await runProcess(
          "security",
          ["add-generic-password", "-U", "-s", this.service, "-a", id, "-w", value],
          { timeoutMs: 1e4 }
        );
        if (result.spawnError || result.code !== 0) {
          throw new Error(`macOS Keychain write failed: ${result.stderr.trim() || "unknown error"}`);
        }
        addToIndex(id);
      }
      async delete(id) {
        await runProcess("security", ["delete-generic-password", "-s", this.service, "-a", id], {
          timeoutMs: 1e4
        });
        removeFromIndex(id);
      }
    };
    SecretServiceBackend = class {
      id = "os-secret-service";
      label = "Secret Service (libsecret)";
      service = "comicode";
      async available() {
        if (process.platform !== "linux") return false;
        const result = await runProcess("secret-tool", ["--version"], { timeoutMs: 5e3 });
        return !result.spawnError;
      }
      async get(id) {
        const result = await runProcess(
          "secret-tool",
          ["lookup", "service", this.service, "account", id],
          { timeoutMs: 1e4 }
        );
        if (result.spawnError || result.code !== 0) return null;
        return result.stdout;
      }
      async set(id, value) {
        const result = await runProcess(
          "secret-tool",
          ["store", "--label", `ComiCode (${id})`, "service", this.service, "account", id],
          { stdin: value, timeoutMs: 1e4 }
        );
        if (result.spawnError || result.code !== 0) {
          throw new Error(`Secret Service write failed: ${result.stderr.trim() || "unknown error"}`);
        }
        addToIndex(id);
      }
      async delete(id) {
        await runProcess("secret-tool", ["clear", "service", this.service, "account", id], {
          timeoutMs: 1e4
        });
        removeFromIndex(id);
      }
    };
    EnvironmentBackend = class {
      id = "environment";
      label = "Environment variables";
      map = /* @__PURE__ */ new Map();
      async available() {
        return true;
      }
      envName(id) {
        return `COMICODE_SECRET_${id.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;
      }
      async get(id) {
        const value = process.env[this.envName(id)] ?? this.map.get(id) ?? null;
        return value || null;
      }
      async set(id, value) {
        this.map.set(id, value);
        addToIndex(id);
      }
      async delete(id) {
        this.map.delete(id);
        removeFromIndex(id);
      }
    };
    CredentialStore = class {
      backend = null;
      fallback;
      initialized = false;
      forced;
      constructor(forcedBackend = process.env.COMICODE_CREDENTIAL_BACKEND ?? null) {
        this.forced = forcedBackend;
        this.fallback = new EncryptedFileBackend();
      }
      async init() {
        if (this.initialized) return;
        this.initialized = true;
        const forced = this.forced?.toLowerCase();
        const osBackends = [new DpapiBackend(), new MacKeychainBackend(), new SecretServiceBackend()];
        if (forced === "file") {
          this.backend = this.fallback;
          return;
        }
        if (forced === "env" || forced === "environment") {
          this.backend = new EnvironmentBackend();
          return;
        }
        if (forced === "os") {
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
        logger.info("Using encrypted local credential fallback.");
      }
      async describe() {
        await this.init();
        const backend = this.backend ?? this.fallback;
        const secure = backend.id !== "encrypted-file" || Boolean(process.env.COMICODE_MASTER_KEY);
        const detail = backend.id === "encrypted-file" ? `${join3(getComicodeHome(), "credentials.enc.json")} (AES-256-GCM; key in master.key)` : backend.id === "environment" ? "Secrets read from COMICODE_SECRET_* environment variables" : "Secrets are protected by the operating system credential facility";
        return {
          id: backend.id,
          label: backend.label,
          secure,
          detail
        };
      }
      async getSecret(id) {
        await this.init();
        try {
          const value = await (this.backend ?? this.fallback).get(id);
          if (value !== null) return value;
          if (this.backend && this.backend.id !== "encrypted-file") {
            return await this.fallback.get(id);
          }
          return null;
        } catch (error) {
          logger.warn(`Credential read failed for ${id}: ${String(error)}`);
          return null;
        }
      }
      async setSecret(id, value) {
        await this.init();
        const trimmed = value.trim();
        if (!trimmed) throw new Error("Secret cannot be empty.");
        try {
          await (this.backend ?? this.fallback).set(id, trimmed);
        } catch (error) {
          logger.warn(`Credential backend write failed; using encrypted fallback. ${String(error)}`);
          this.backend = this.fallback;
          await this.fallback.set(id, trimmed);
        }
      }
      async deleteSecret(id) {
        await this.init();
        try {
          await (this.backend ?? this.fallback).delete(id);
        } catch (error) {
          logger.debug(`Credential backend delete failed: ${String(error)}`);
        }
        try {
          await this.fallback.delete(id);
        } catch {
        }
        removeFromIndex(id);
      }
      listSecretIds() {
        return readIndex();
      }
      async deleteAllSecrets() {
        const ids = new Set(readIndex());
        for (const id of ids) {
          await this.deleteSecret(id);
        }
      }
    };
    singleton = null;
  }
});

// src/core/providers/adapter.ts
function normalizeBaseUrl(url) {
  return url.trim().replace(/\/+$/, "");
}
function joinUrl(baseUrl, path) {
  const base = normalizeBaseUrl(baseUrl);
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}
function withTimeout(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  return AbortSignal.any([signal, timeout]);
}
function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function asRecord(value) {
  return typeof value === "object" && value !== null ? value : null;
}
var init_adapter = __esm({
  "src/core/providers/adapter.ts"() {
    "use strict";
  }
});

// src/core/providers/errors.ts
function isRetryableCategory(category) {
  return category === "rate_limit" || category === "provider_outage" || category === "network";
}
function getHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") {
    return headers.get(name);
  }
  const record = headers;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === lower) {
      if (Array.isArray(value)) return value[0] ?? null;
      return value ?? null;
    }
  }
  return null;
}
function parseRetryAfter(value, nowMs = Date.now()) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[+-]/.test(trimmed)) return null;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return new Date(nowMs + seconds * 1e3).toISOString();
  }
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) return new Date(date).toISOString();
  return null;
}
function parseDurationMs(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1e3);
  const match = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(trimmed);
  if (!match) return null;
  const [, h, m, s] = match;
  if (!h && !m && !s) return null;
  return Math.round((Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)) * 1e3);
}
function parseUnixOrIso(value) {
  const trimmed = value.trim();
  if (/^\d{10}$/.test(trimmed)) return new Date(Number(trimmed) * 1e3).toISOString();
  if (/^\d{13}$/.test(trimmed)) return new Date(Number(trimmed)).toISOString();
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function parseErrorBody(raw) {
  const fallback = raw.replace(/\s+/g, " ").trim().slice(0, 800);
  if (!raw.trim()) {
    return { message: "", code: null, type: null, statusText: null, retryDelay: null };
  }
  try {
    const parsed = JSON.parse(raw);
    const error = parsed.error && typeof parsed.error === "object" ? parsed.error : parsed;
    let message = "";
    if (typeof error.message === "string") message = error.message;
    else if (typeof parsed.message === "string") message = parsed.message;
    else message = fallback;
    let retryDelay = null;
    const details = error.details;
    if (Array.isArray(details)) {
      for (const item of details) {
        if (item && typeof item === "object") {
          const record = item;
          if (typeof record.retryDelay === "string") retryDelay = record.retryDelay;
        }
      }
    }
    if (!retryDelay && typeof error.retryDelay === "string") retryDelay = error.retryDelay;
    if (!retryDelay && typeof parsed.retryDelay === "string") retryDelay = parsed.retryDelay;
    const codeValue = error.code ?? parsed.code;
    const typeValue = error.type ?? parsed.type;
    const statusValue = error.status ?? parsed.status;
    const inferredRetry = /retry in ([\d.]+)\s*s/i.exec(message)?.[1];
    if (!retryDelay && inferredRetry) retryDelay = `${inferredRetry}s`;
    return {
      message: redactSecrets(message).slice(0, 800),
      code: codeValue === void 0 || codeValue === null ? null : String(codeValue),
      type: typeValue === void 0 || typeValue === null ? null : String(typeValue),
      statusText: statusValue === void 0 || statusValue === null ? null : String(statusValue),
      retryDelay
    };
  } catch {
    return {
      message: redactSecrets(fallback),
      code: null,
      type: null,
      statusText: null,
      retryDelay: /retry in ([\d.]+)\s*s/i.exec(fallback)?.[1] ? `${/retry in ([\d.]+)\s*s/i.exec(fallback)[1]}s` : null
    };
  }
}
function detectContextLength(text) {
  return /context (?:window|length)|maximum context|too many tokens|context_length_exceeded|input is too long|token limit/i.test(
    text
  );
}
function detectDailyQuota(text) {
  return /per day|daily|today['’]s quota|quota (?:has been )?(?:exceeded|exhausted)|exceeded (?:your|the) (?:current )?quota|free.?tier.*(?:limit|quota)|RPD\b|requests per day|insufficient_quota/i.test(
    text
  );
}
function detectToolSupport(text) {
  return /tool(?:s| calling| use)? (?:is |are )?not supported|function calling (?:is )?not supported|does not support (?:tools|function)/i.test(
    text
  );
}
function detectBilling(text) {
  return /billing|payment required|credit balance|insufficient (?:funds|credits)|spend limit|hard limit|requires a paid|paid plan/i.test(
    text
  );
}
function classifyProviderError(input) {
  const nowMs = input.nowMs ?? Date.now();
  const providerId = input.providerId;
  const status = input.status ?? null;
  const body = input.body ?? "";
  const parsed = parseErrorBody(body);
  const text = [parsed.message, parsed.code, parsed.type, parsed.statusText, body].filter(Boolean).join(" ").slice(0, 4e3);
  const retryAfterAt = parseRetryAfter(getHeader(input.headers, "retry-after"), nowMs);
  let resetAt = null;
  const resetHeader = getHeader(input.headers, "x-ratelimit-reset-requests") ?? getHeader(input.headers, "x-ratelimit-reset-tokens") ?? getHeader(input.headers, "x-ratelimit-reset");
  if (resetHeader) {
    resetAt = parseUnixOrIso(resetHeader);
    if (!resetAt) {
      const duration = parseDurationMs(resetHeader);
      if (duration !== null) resetAt = new Date(nowMs + duration).toISOString();
    }
  }
  const geminiReset = parsed.retryDelay ? parseDurationMs(parsed.retryDelay) : null;
  const effectiveRetryAfter = retryAfterAt ?? (geminiReset !== null ? new Date(nowMs + geminiReset).toISOString() : null);
  const failure = input.error;
  if (failure) {
    const message = safeErrorMessage(failure);
    const isAbort = failure instanceof Error && failure.name === "AbortError" || /aborted|cancell?ed/i.test(message);
    if (isAbort) {
      return new ProviderError({
        category: "cancelled",
        message: "Request cancelled.",
        providerId,
        retryable: false
      });
    }
    const isNetwork = failure instanceof TypeError || /fetch failed|network|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|getaddrinfo/i.test(
      message
    );
    return new ProviderError({
      category: isNetwork ? "network" : "unknown",
      message: message || "Network request failed.",
      providerId,
      status,
      retryable: isNetwork,
      retryAfterAt: effectiveRetryAfter,
      resetAt,
      providerCode: parsed.code
    });
  }
  const base = {
    providerId,
    status,
    retryAfterAt: effectiveRetryAfter,
    resetAt,
    providerCode: parsed.code ?? parsed.statusText,
    message: parsed.message || `Provider request failed${status ? ` with HTTP ${status}` : ""}.`
  };
  if (status === 401) {
    const category = /invalid.*(?:api key|key)|api key not valid/i.test(text) ? "invalid_api_key" : "auth_failure";
    return new ProviderError({ ...base, category, retryable: false });
  }
  if (status === 402) {
    return new ProviderError({ ...base, category: "billing_restriction", retryable: false });
  }
  if (status === 403) {
    return new ProviderError({
      ...base,
      category: detectBilling(text) ? "billing_restriction" : "permission_error",
      retryable: false
    });
  }
  if (status === 404) {
    return new ProviderError({ ...base, category: "model_unavailable", retryable: false });
  }
  if (status === 429) {
    return new ProviderError({
      ...base,
      category: detectDailyQuota(text) ? "daily_quota" : "rate_limit",
      retryable: true
    });
  }
  if (status === 408 || status === 504) {
    return new ProviderError({ ...base, category: "provider_outage", retryable: true });
  }
  if (status && status >= 500) {
    return new ProviderError({ ...base, category: "provider_outage", retryable: true });
  }
  if (status === 400 || status === 413 || status === 422) {
    if (detectContextLength(text)) {
      return new ProviderError({ ...base, category: "context_length", retryable: false });
    }
    if (detectToolSupport(text)) {
      return new ProviderError({
        ...base,
        category: "unsupported_tool_calling",
        retryable: false
      });
    }
    if (/invalid.*(?:api key|key)|api key not valid/i.test(text)) {
      return new ProviderError({ ...base, category: "invalid_api_key", retryable: false });
    }
    if (/model.*(?:not found|does not exist|not available|unavailable|decommissioned)/i.test(text)) {
      return new ProviderError({ ...base, category: "model_unavailable", retryable: false });
    }
    return new ProviderError({ ...base, category: "invalid_request", retryable: false });
  }
  if (/model.*(?:not found|does not exist|not available|unavailable|decommissioned)/i.test(text)) {
    return new ProviderError({ ...base, category: "model_unavailable", retryable: false });
  }
  if (detectDailyQuota(text)) {
    return new ProviderError({ ...base, category: "daily_quota", retryable: true });
  }
  if (/rate limit|too many requests|quota exceeded/i.test(text)) {
    return new ProviderError({ ...base, category: "rate_limit", retryable: true });
  }
  if (detectContextLength(text)) {
    return new ProviderError({ ...base, category: "context_length", retryable: false });
  }
  return new ProviderError({ ...base, category: "unknown", retryable: false });
}
function classifyThrown(error, providerId) {
  if (error instanceof ProviderError) return error;
  return classifyProviderError({ providerId, error });
}
function describeCategory(category) {
  switch (category) {
    case "rate_limit":
      return "Rate limit";
    case "daily_quota":
      return "Daily/provider quota exhausted";
    case "provider_outage":
      return "Provider outage";
    case "network":
      return "Network failure";
    case "invalid_api_key":
      return "Invalid API key";
    case "auth_failure":
      return "Authentication failure";
    case "permission_error":
      return "Permission denied";
    case "model_unavailable":
      return "Model unavailable";
    case "unsupported_tool_calling":
      return "Tool calling unsupported";
    case "context_length":
      return "Context length exceeded";
    case "billing_restriction":
      return "Billing restriction";
    case "invalid_request":
      return "Invalid request";
    case "cancelled":
      return "Cancelled";
    default:
      return "Unknown provider error";
  }
}
var ProviderError;
var init_errors = __esm({
  "src/core/providers/errors.ts"() {
    "use strict";
    init_redact();
    ProviderError = class extends Error {
      category;
      status;
      retryable;
      retryAfterAt;
      resetAt;
      providerCode;
      providerId;
      constructor(input) {
        super(redactSecrets(input.message));
        this.name = "ProviderError";
        this.category = input.category;
        this.providerId = input.providerId;
        this.status = input.status ?? null;
        this.retryable = input.retryable ?? isRetryableCategory(input.category);
        this.retryAfterAt = input.retryAfterAt ?? null;
        this.resetAt = input.resetAt ?? null;
        this.providerCode = input.providerCode ?? null;
      }
      toJSON() {
        return {
          name: this.name,
          message: this.message,
          category: this.category,
          status: this.status,
          providerId: this.providerId,
          retryable: this.retryable,
          retryAfterAt: this.retryAfterAt,
          resetAt: this.resetAt,
          providerCode: this.providerCode
        };
      }
    };
  }
});

// src/core/providers/profile-config.ts
import { z } from "zod";
function readEndpointConfig(profile) {
  const parsed = EndpointConfigSchema.safeParse(profile.config ?? {});
  return parsed.success ? parsed.data : EndpointConfigSchema.parse({});
}
function endpointConfigForStorage(raw) {
  const parsed = EndpointConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new Error(
      `Invalid endpoint configuration: ${parsed.error.issues[0]?.message ?? "unknown"}`
    );
  }
  const copy = { ...parsed.data };
  for (const key of Object.keys(copy)) {
    if (/apikey|api_key|token|secret|password|authorization/i.test(key)) delete copy[key];
  }
  return copy;
}
function sanitizeExtraHeaders(headers) {
  const output = {};
  for (const [key, value] of Object.entries(headers)) {
    const trimmedKey = key.trim();
    if (!/^[A-Za-z0-9-]+$/.test(trimmedKey)) continue;
    if (/authorization|api[-_]?key|cookie/i.test(trimmedKey)) continue;
    output[trimmedKey] = value.replace(/[\r\n]/g, "").slice(0, 500);
  }
  return output;
}
var EndpointConfigSchema;
var init_profile_config = __esm({
  "src/core/providers/profile-config.ts"() {
    "use strict";
    EndpointConfigSchema = z.object({
      /** Protocol used by a custom endpoint. Built-in providers have fixed defaults. */
      apiStyle: z.enum(["openai-compatible", "gemini"]).default("openai-compatible"),
      /** Local servers such as Ollama/LM Studio may not require an API key. */
      allowNoAuth: z.boolean().default(false),
      /** Header used to send the credential (custom endpoints). */
      authHeader: z.string().min(1).max(100).default("Authorization"),
      /** Prefix for the credential value. Use an empty string for headers like `api-key`. */
      authPrefix: z.string().max(100).default("Bearer "),
      /** Additional non-secret headers sent with every request. */
      extraHeaders: z.record(z.string(), z.string()).default({}),
      chatPath: z.string().min(1).max(300).default("/chat/completions"),
      modelsPath: z.string().min(1).max(300).default("/models"),
      maxTokensParam: z.enum(["max_tokens", "max_completion_tokens"]).default("max_tokens"),
      supportsModelDiscovery: z.boolean().default(true),
      supportsStreaming: z.boolean().default(true),
      /** Explicitly opt in to a tiny paid/consuming request for connection tests. */
      testWithChat: z.boolean().default(false),
      /** Some gateways reject stream_options; enable to request token usage in streams. */
      streamUsage: z.boolean().default(false),
      /** Optional override when the endpoint does not publish context limits. */
      contextWindowOverride: z.number().int().positive().nullable().default(null),
      /** A human-readable preset name (e.g. DeepSeek, Ollama). */
      preset: z.string().max(100).nullable().default(null),
      notes: z.string().max(1e3).nullable().default(null)
    }).passthrough();
  }
});

// src/core/providers/gemini.ts
import { randomUUID } from "crypto";
function stripModelPrefix(model) {
  return model.replace(/^models\//, "");
}
function geminiType(value) {
  if (typeof value === "string") {
    const upper = value.toUpperCase();
    if (["STRING", "NUMBER", "INTEGER", "BOOLEAN", "ARRAY", "OBJECT"].includes(upper)) return upper;
    return "STRING";
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry !== "null" && entry !== null) {
        const converted = geminiType(entry);
        if (converted) return converted;
      }
    }
  }
  return void 0;
}
function toGeminiSchema(schema) {
  const record = asRecord(schema);
  if (!record) return { type: "OBJECT", properties: {} };
  const output = {};
  const type = geminiType(record.type);
  if (type) output.type = type;
  if (typeof record.description === "string") output.description = record.description;
  if (Array.isArray(record.enum)) output.enum = record.enum.map((entry) => String(entry));
  if (typeof record.format === "string") output.format = record.format;
  if (record.nullable === true) output.nullable = true;
  if (record.properties && typeof record.properties === "object") {
    const properties = {};
    for (const [key, value] of Object.entries(record.properties)) {
      properties[key] = toGeminiSchema(value);
    }
    output.properties = properties;
    if (!output.type) output.type = "OBJECT";
  }
  if (record.items) output.items = toGeminiSchema(record.items);
  if (Array.isArray(record.required)) {
    output.required = record.required.filter((entry) => typeof entry === "string");
  }
  if (output.type === "OBJECT" && !output.properties) output.properties = {};
  return output;
}
function buildContents(messages) {
  const contents = [];
  const systemParts = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === "system") {
      systemParts.push(message.content);
      continue;
    }
    if (message.role === "assistant") {
      const parts = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.arguments ?? {} } });
      }
      if (parts.length) contents.push({ role: "model", parts });
      continue;
    }
    if (message.role === "tool") {
      const responseParts = [];
      let cursor = index;
      while (cursor < messages.length) {
        const toolMessage = messages[cursor];
        if (!toolMessage || toolMessage.role !== "tool") break;
        let parsed = toolMessage.content;
        try {
          parsed = JSON.parse(toolMessage.content);
        } catch {
        }
        responseParts.push({
          functionResponse: {
            name: toolMessage.name,
            response: asRecord(parsed) !== null ? parsed : { result: String(toolMessage.content).slice(0, 1e5) }
          }
        });
        cursor += 1;
      }
      contents.push({ role: "user", parts: responseParts });
      index = cursor - 1;
      continue;
    }
    contents.push({ role: "user", parts: [{ text: message.content }] });
  }
  return {
    contents,
    systemInstruction: systemParts.length ? systemParts.join("\n\n") : null
  };
}
function parseFunctionCalls(parts) {
  const calls = [];
  parts.forEach((part, index) => {
    const record = asRecord(part);
    const fn = record ? asRecord(record.functionCall) : null;
    if (!fn || typeof fn.name !== "string" || !fn.name) return;
    const args = asRecord(fn.args) ?? {};
    calls.push({
      id: `gemini_${index}_${randomUUID().slice(0, 8)}`,
      name: fn.name,
      arguments: args
    });
  });
  return calls;
}
function parseGeminiResponse(data) {
  const record = asRecord(data);
  const candidates = record?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("Gemini returned no candidates.");
  }
  const candidate = asRecord(candidates[0]);
  const content = asRecord(candidate?.content);
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  let text = "";
  for (const part of parts) {
    const partRecord = asRecord(part);
    if (partRecord && typeof partRecord.text === "string" && partRecord.thought !== true) {
      text += partRecord.text;
    }
  }
  const usageMeta = asRecord(record?.usageMetadata);
  const usage2 = usageMeta ? {
    inputTokens: toNumber(usageMeta.promptTokenCount) ?? 0,
    outputTokens: toNumber(usageMeta.candidatesTokenCount) ?? 0,
    totalTokens: toNumber(usageMeta.totalTokenCount) ?? (toNumber(usageMeta.promptTokenCount) ?? 0) + (toNumber(usageMeta.candidatesTokenCount) ?? 0)
  } : null;
  return {
    content: text,
    toolCalls: parseFunctionCalls(parts),
    usage: usage2,
    finishReason: typeof candidate?.finishReason === "string" ? candidate.finishReason : null
  };
}
function buildHeaders(context) {
  const config = readEndpointConfig(context.profile);
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
    ...sanitizeExtraHeaders(config.extraHeaders)
  };
  const key = context.apiKey.trim();
  if (key) {
    registerSecret(key);
    headers["x-goog-api-key"] = key;
  } else if (!config.allowNoAuth) {
    throw classifyProviderError({
      providerId: context.profile.providerId,
      status: 401,
      body: JSON.stringify({
        error: { message: `No API key configured for profile "${context.profile.name}".` }
      })
    });
  }
  return headers;
}
async function fetchChecked(context, url, init, timeoutMs) {
  const fetchImpl = context.fetchImpl ?? globalThis.fetch;
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: withTimeout(context.signal, timeoutMs) });
  } catch (error) {
    throw classifyThrown(error, context.profile.providerId);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw classifyProviderError({
      providerId: context.profile.providerId,
      status: response.status,
      headers: response.headers,
      body
    });
  }
  return response;
}
var NON_CHAT_PATTERN, GeminiAdapter;
var init_gemini = __esm({
  "src/core/providers/gemini.ts"() {
    "use strict";
    init_redact();
    init_adapter();
    init_errors();
    init_profile_config();
    NON_CHAT_PATTERN = /embedding|aqa|imagen|veo|learnlm/i;
    GeminiAdapter = class {
      kind;
      supportsStreaming = true;
      constructor(kind = "gemini") {
        this.kind = kind;
      }
      base(context) {
        const base = normalizeBaseUrl(context.baseUrl ?? context.profile.baseUrl);
        if (!base) {
          throw classifyProviderError({
            providerId: context.profile.providerId,
            status: 400,
            body: JSON.stringify({ error: { message: "No base URL configured for this profile." } })
          });
        }
        return base;
      }
      async chat(context, request, options = {}) {
        const config = readEndpointConfig(context.profile);
        const model = stripModelPrefix(request.model);
        const streaming = Boolean(options.onText) && config.supportsStreaming;
        const url = streaming ? `${this.base(context)}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse` : `${this.base(context)}/models/${encodeURIComponent(model)}:generateContent`;
        const { contents, systemInstruction } = buildContents(request.messages);
        const body = { contents };
        if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
        if (request.tools?.length) {
          body.tools = [
            {
              functionDeclarations: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: toGeminiSchema(tool.parameters)
              }))
            }
          ];
        }
        const generationConfig = {};
        if (request.temperature !== void 0) generationConfig.temperature = request.temperature;
        if (request.maxOutputTokens !== void 0) {
          generationConfig.maxOutputTokens = request.maxOutputTokens;
        }
        if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
        const response = await fetchChecked(
          context,
          url,
          { method: "POST", headers: buildHeaders(context), body: JSON.stringify(body) },
          18e4
        );
        const contentType = response.headers.get("content-type") ?? "";
        if (!streaming || !contentType.includes("text/event-stream")) {
          const data = await response.json();
          return parseGeminiResponse(data);
        }
        return this.consumeStream(response, options);
      }
      async consumeStream(response, options) {
        if (!response.body) {
          throw classifyProviderError({
            providerId: this.kind,
            status: 502,
            body: JSON.stringify({ error: { message: "Gemini returned an empty stream." } })
          });
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let content = "";
        let finishReason = null;
        let usage2 = null;
        const calls = [];
        const seen = /* @__PURE__ */ new Set();
        const handleEvent = (data) => {
          if (!data || data === "[DONE]") return;
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            return;
          }
          const record = asRecord(parsed);
          if (!record) return;
          const usageMeta = asRecord(record.usageMetadata);
          if (usageMeta) {
            usage2 = {
              inputTokens: toNumber(usageMeta.promptTokenCount) ?? usage2?.inputTokens ?? 0,
              outputTokens: toNumber(usageMeta.candidatesTokenCount) ?? usage2?.outputTokens ?? 0,
              totalTokens: toNumber(usageMeta.totalTokenCount) ?? (toNumber(usageMeta.promptTokenCount) ?? 0) + (toNumber(usageMeta.candidatesTokenCount) ?? 0)
            };
          }
          const candidates = record.candidates;
          if (!Array.isArray(candidates) || candidates.length === 0) return;
          const candidate = asRecord(candidates[0]);
          if (!candidate) return;
          if (typeof candidate.finishReason === "string") finishReason = candidate.finishReason;
          const parts = asRecord(candidate.content)?.parts;
          if (!Array.isArray(parts)) return;
          for (const part of parts) {
            const partRecord = asRecord(part);
            if (!partRecord) continue;
            if (typeof partRecord.text === "string" && partRecord.thought !== true) {
              content += partRecord.text;
              options.onText?.(partRecord.text);
            }
            const fn = asRecord(partRecord.functionCall);
            if (fn && typeof fn.name === "string" && fn.name) {
              const args = asRecord(fn.args) ?? {};
              const signature = `${fn.name}:${JSON.stringify(args)}`;
              if (!seen.has(signature)) {
                seen.add(signature);
                calls.push({
                  id: `gemini_${calls.length}_${randomUUID().slice(0, 8)}`,
                  name: fn.name,
                  arguments: args
                });
              }
            }
          }
        };
        try {
          for (; ; ) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary = buffer.search(/\r?\n\r?\n/);
            while (boundary !== -1) {
              const rawEvent = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + (buffer[boundary] === "\r" ? 4 : 2));
              const dataLines = rawEvent.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart());
              if (dataLines.length) handleEvent(dataLines.join("\n"));
              boundary = buffer.search(/\r?\n\r?\n/);
            }
          }
          if (buffer.trim()) {
            const dataLines = buffer.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart());
            if (dataLines.length) handleEvent(dataLines.join("\n"));
          }
        } catch (error) {
          throw classifyThrown(error, this.kind);
        } finally {
          reader.releaseLock();
        }
        return { content, toolCalls: calls, usage: usage2, finishReason };
      }
      async listModels(context) {
        const config = readEndpointConfig(context.profile);
        if (!config.supportsModelDiscovery) {
          throw classifyProviderError({
            providerId: this.kind,
            status: 400,
            body: JSON.stringify({
              error: { message: "Model discovery is disabled for this profile." }
            })
          });
        }
        const models = [];
        let pageToken = null;
        for (let page = 0; page < 10; page += 1) {
          const url = new URL(joinUrl(this.base(context), config.modelsPath));
          url.searchParams.set("pageSize", "1000");
          if (pageToken) url.searchParams.set("pageToken", pageToken);
          const response = await fetchChecked(
            context,
            url.toString(),
            { method: "GET", headers: buildHeaders(context) },
            3e4
          );
          const payload = await response.json();
          const record = asRecord(payload);
          const list = record && Array.isArray(record.models) ? record.models : [];
          for (const entry of list) {
            const model = asRecord(entry);
            if (!model) continue;
            const name = typeof model.name === "string" ? model.name : "";
            const id = stripModelPrefix(name);
            if (!id || NON_CHAT_PATTERN.test(id)) continue;
            const methods = Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods.filter(
              (item) => typeof item === "string"
            ) : [];
            if (methods.length && !methods.includes("generateContent")) continue;
            models.push({
              modelId: id,
              displayName: typeof model.displayName === "string" && model.displayName.trim() ? model.displayName : id,
              contextWindow: toNumber(model.inputTokenLimit) ?? null,
              maxOutputTokens: toNumber(model.outputTokenLimit) ?? null,
              supportsTools: void 0,
              supportsVision: void 0,
              metadata: {
                description: typeof model.description === "string" ? model.description : void 0,
                supportedGenerationMethods: methods
              }
            });
          }
          pageToken = record && typeof record.nextPageToken === "string" && record.nextPageToken ? record.nextPageToken : null;
          if (!pageToken) break;
        }
        return models;
      }
      async testConnection(context) {
        const started = Date.now();
        try {
          const models = await this.listModels(context);
          return {
            ok: true,
            latencyMs: Date.now() - started,
            modelCount: models.length,
            message: `Connected. ${models.length} model${models.length === 1 ? "" : "s"} discovered.`
          };
        } catch (error) {
          const classified = classifyThrown(error, this.kind);
          return {
            ok: false,
            latencyMs: Date.now() - started,
            modelCount: null,
            message: classified.message,
            category: classified.category
          };
        }
      }
    };
  }
});

// src/core/providers/openai-compatible.ts
import { randomUUID as randomUUID2 } from "crypto";
function contentToString(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((part) => {
      const record = asRecord(part);
      if (!record) return "";
      if (typeof record.text === "string") return record.text;
      return "";
    }).join("");
  }
  return "";
}
function parseArguments(raw) {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    const record = asRecord(parsed);
    return record ?? { value: parsed };
  } catch {
    return {};
  }
}
function decodeToolCalls(raw) {
  if (!Array.isArray(raw)) return [];
  const calls = [];
  raw.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) return;
    const fn = asRecord(record.function);
    const name = fn && typeof fn.name === "string" ? fn.name : "";
    if (!name) return;
    const args = fn && typeof fn.arguments === "string" ? parseArguments(fn.arguments) : fn && asRecord(fn.arguments) ? fn.arguments : {};
    calls.push({
      id: typeof record.id === "string" && record.id ? record.id : `call_${index}_${randomUUID2().slice(0, 8)}`,
      name,
      arguments: args
    });
  });
  return calls;
}
function decodeUsage(raw) {
  const record = asRecord(raw);
  if (!record) return null;
  const input = toNumber(record.prompt_tokens ?? record.input_tokens) ?? 0;
  const output = toNumber(record.completion_tokens ?? record.output_tokens) ?? 0;
  const total = toNumber(record.total_tokens) ?? input + output;
  if (input === 0 && output === 0 && total === 0) return null;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}
function buildHeaders2(context) {
  const config = readEndpointConfig(context.profile);
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
    ...sanitizeExtraHeaders(config.extraHeaders)
  };
  const key = context.apiKey.trim();
  if (key) {
    registerSecret(key);
    const headerName = config.authHeader || "Authorization";
    const prefix = config.authPrefix ?? "Bearer ";
    headers[headerName] = `${prefix}${key}`;
  } else if (!config.allowNoAuth && context.profile.providerId !== "custom") {
    throw new ProviderError({
      category: "invalid_api_key",
      providerId: context.profile.providerId,
      message: `No API key configured for profile "${context.profile.name}".`,
      retryable: false
    });
  }
  if (context.profile.providerId === "openrouter") {
    if (!headers["HTTP-Referer"] && !headers["http-referer"]) {
      headers["HTTP-Referer"] = "https://github.com/ComibyteOrg/comicode";
    }
    if (!headers["X-Title"] && !headers["x-title"]) {
      headers["X-Title"] = "ComiCode";
    }
  }
  return headers;
}
function buildMessages(messages) {
  return messages.map((message) => {
    if (message.role === "assistant") {
      const output = {
        role: "assistant",
        content: message.content ?? ""
      };
      if (message.toolCalls?.length) {
        output.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) }
        }));
      }
      return output;
    }
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        name: message.name,
        content: message.content
      };
    }
    return { role: message.role, content: message.content };
  });
}
function buildRequestBody(context, request, streaming) {
  const config = readEndpointConfig(context.profile);
  const body = {
    model: request.model,
    messages: buildMessages(request.messages),
    stream: streaming
  };
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
    body.tool_choice = "auto";
  }
  if (request.temperature !== void 0) body.temperature = request.temperature;
  if (request.maxOutputTokens !== void 0) {
    body[config.maxTokensParam] = request.maxOutputTokens;
  }
  if (streaming && config.streamUsage) {
    body.stream_options = { include_usage: true };
  }
  return body;
}
async function fetchChecked2(context, url, init, timeoutMs) {
  const fetchImpl = context.fetchImpl ?? globalThis.fetch;
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: withTimeout(context.signal, timeoutMs)
    });
  } catch (error) {
    throw classifyThrown(error, context.profile.providerId);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw classifyProviderError({
      providerId: context.profile.providerId,
      status: response.status,
      headers: response.headers,
      body
    });
  }
  return response;
}
function parseCompletion(data, providerId) {
  const record = asRecord(data);
  const choices = record?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ProviderError({
      category: "unknown",
      providerId,
      message: "Provider returned no completion choices.",
      retryable: false
    });
  }
  const choice = asRecord(choices[0]);
  const message = asRecord(choice?.message);
  const content = contentToString(message?.content);
  const toolCalls = decodeToolCalls(message?.tool_calls);
  return {
    content,
    toolCalls,
    usage: decodeUsage(record?.usage),
    finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null
  };
}
var NON_CHAT_PATTERN2, OpenAICompatibleAdapter;
var init_openai_compatible = __esm({
  "src/core/providers/openai-compatible.ts"() {
    "use strict";
    init_redact();
    init_adapter();
    init_errors();
    init_profile_config();
    NON_CHAT_PATTERN2 = /embedding|embed-|whisper|tts|text-to-speech|dall-e|moderation|rerank|image-generation|stable-diffusion|flux/i;
    OpenAICompatibleAdapter = class {
      kind;
      supportsStreaming = true;
      constructor(kind) {
        this.kind = kind;
      }
      endpoint(context, path) {
        const base = normalizeBaseUrl(context.baseUrl ?? context.profile.baseUrl);
        if (!base) {
          throw new ProviderError({
            category: "invalid_request",
            providerId: this.kind,
            message: "No base URL configured for this profile.",
            retryable: false
          });
        }
        return joinUrl(base, path);
      }
      async chat(context, request, options = {}) {
        const config = readEndpointConfig(context.profile);
        const wantsStream = Boolean(options.onText) && config.supportsStreaming;
        const response = await fetchChecked2(
          context,
          this.endpoint(context, config.chatPath),
          {
            method: "POST",
            headers: buildHeaders2(context),
            body: JSON.stringify(buildRequestBody(context, request, wantsStream))
          },
          18e4
        );
        const contentType = response.headers.get("content-type") ?? "";
        if (!wantsStream || contentType.includes("application/json")) {
          const text = await response.text();
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            throw new ProviderError({
              category: "unknown",
              providerId: this.kind,
              message: `Provider returned malformed JSON: ${text.slice(0, 300)}`,
              retryable: false
            });
          }
          return parseCompletion(parsed, this.kind);
        }
        return this.consumeStream(response, options);
      }
      async consumeStream(response, options) {
        if (!response.body) {
          throw new ProviderError({
            category: "network",
            providerId: this.kind,
            message: "Provider returned an empty streaming response.",
            retryable: true
          });
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let content = "";
        let finishReason = null;
        let usage2 = null;
        const calls = /* @__PURE__ */ new Map();
        const handleEvent = (data) => {
          if (!data || data === "[DONE]") return;
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            return;
          }
          const record = asRecord(parsed);
          if (!record) return;
          const decodedUsage = decodeUsage(record.usage);
          if (decodedUsage) usage2 = decodedUsage;
          const choices = record.choices;
          if (!Array.isArray(choices) || choices.length === 0) return;
          const choice = asRecord(choices[0]);
          if (!choice) return;
          const delta = asRecord(choice.delta);
          if (delta) {
            const text = contentToString(delta.content);
            if (text) {
              content += text;
              options.onText?.(text);
            }
            const toolDeltas = delta.tool_calls;
            if (Array.isArray(toolDeltas)) {
              toolDeltas.forEach((entry, fallbackIndex) => {
                const tool = asRecord(entry);
                if (!tool) return;
                const index = typeof tool.index === "number" ? tool.index : fallbackIndex;
                const existing = calls.get(index) ?? { id: "", name: "", args: "" };
                if (typeof tool.id === "string" && tool.id) existing.id = tool.id;
                const fn = asRecord(tool.function);
                if (fn) {
                  if (typeof fn.name === "string" && fn.name) existing.name += fn.name;
                  if (typeof fn.arguments === "string") existing.args += fn.arguments;
                }
                calls.set(index, existing);
              });
            }
          }
          if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
        };
        try {
          for (; ; ) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary = buffer.search(/\r?\n\r?\n/);
            while (boundary !== -1) {
              const rawEvent = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + (buffer[boundary] === "\r" ? 4 : 2));
              const dataLines = rawEvent.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart());
              if (dataLines.length) handleEvent(dataLines.join("\n"));
              boundary = buffer.search(/\r?\n\r?\n/);
            }
          }
          if (buffer.trim()) {
            const dataLines = buffer.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart());
            if (dataLines.length) handleEvent(dataLines.join("\n"));
          }
        } catch (error) {
          throw classifyThrown(error, this.kind);
        } finally {
          reader.releaseLock();
        }
        const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).filter(([, call]) => call.name.length > 0).map(([index, call]) => ({
          id: call.id || `call_${index}_${randomUUID2().slice(0, 8)}`,
          name: call.name,
          arguments: parseArguments(call.args)
        }));
        return { content, toolCalls, usage: usage2, finishReason };
      }
      async listModels(context) {
        const config = readEndpointConfig(context.profile);
        if (!config.supportsModelDiscovery) {
          throw new ProviderError({
            category: "invalid_request",
            providerId: this.kind,
            message: "Model discovery is disabled for this profile.",
            retryable: false
          });
        }
        const response = await fetchChecked2(
          context,
          this.endpoint(context, config.modelsPath),
          { method: "GET", headers: buildHeaders2(context) },
          3e4
        );
        let payload;
        try {
          payload = await response.json();
        } catch (error) {
          throw classifyThrown(error, this.kind);
        }
        const record = asRecord(payload);
        const list = Array.isArray(payload) ? payload : record && Array.isArray(record.data) ? record.data : [];
        if (!Array.isArray(list)) {
          throw new ProviderError({
            category: "invalid_request",
            providerId: this.kind,
            message: "Provider model list response did not contain a model array.",
            retryable: false
          });
        }
        const models = [];
        for (const entry of list) {
          if (typeof entry === "string") {
            if (!NON_CHAT_PATTERN2.test(entry)) {
              models.push({ modelId: entry, displayName: entry });
            }
            continue;
          }
          const model = asRecord(entry);
          if (!model) continue;
          const id = typeof model.id === "string" ? model.id : typeof model.name === "string" ? model.name : "";
          if (!id || NON_CHAT_PATTERN2.test(id)) continue;
          if (model.active === false) continue;
          const pricing = asRecord(model.pricing);
          const priceToMillion = (value) => {
            const parsed = toNumber(value);
            return parsed === null ? null : Math.round(parsed * 1e6 * 1e6) / 1e6;
          };
          const supported = Array.isArray(model.supported_parameters) ? model.supported_parameters.filter((entry2) => typeof entry2 === "string") : null;
          const architecture = asRecord(model.architecture);
          const modalities = Array.isArray(architecture?.input_modalities) ? architecture.input_modalities.filter(
            (entry2) => typeof entry2 === "string"
          ) : null;
          const context2 = toNumber(
            model.context_length ?? model.context_window ?? model.max_context_length ?? model.context
          ) ?? null;
          const maxOutput = toNumber(
            model.max_completion_tokens ?? model.max_output_tokens ?? asRecord(model.top_provider)?.max_completion_tokens
          ) ?? null;
          models.push({
            modelId: id,
            displayName: typeof model.name === "string" && model.name.trim() ? model.name : id,
            contextWindow: context2,
            maxOutputTokens: maxOutput,
            supportsTools: supported ? supported.includes("tools") : void 0,
            supportsVision: modalities ? modalities.some((m) => /image|vision/i.test(m)) : void 0,
            inputPricePerMillion: pricing ? priceToMillion(pricing.prompt) : null,
            outputPricePerMillion: pricing ? priceToMillion(pricing.completion) : null,
            metadata: {
              rawId: id,
              ownedBy: typeof model.owned_by === "string" ? model.owned_by : void 0
            }
          });
        }
        return models;
      }
      async testConnection(context) {
        const started = Date.now();
        const config = readEndpointConfig(context.profile);
        try {
          if (!config.supportsModelDiscovery) {
            if (config.testWithChat) {
              await this.chat(
                context,
                {
                  model: context.profile.defaultModel || "unknown",
                  messages: [{ role: "user", content: "Reply with the single word: ok" }],
                  temperature: 0,
                  maxOutputTokens: 2
                },
                {}
              );
              return {
                ok: true,
                latencyMs: Date.now() - started,
                modelCount: null,
                message: "Live test request succeeded (model discovery is disabled)."
              };
            }
            return {
              ok: true,
              latencyMs: Date.now() - started,
              modelCount: null,
              message: "Endpoint configuration saved. Model discovery is disabled, so no live request was made. Add a model manually or enable testWithChat."
            };
          }
          const models = await this.listModels(context);
          return {
            ok: true,
            latencyMs: Date.now() - started,
            modelCount: models.length,
            message: `Connected. ${models.length} chat model${models.length === 1 ? "" : "s"} discovered.`
          };
        } catch (error) {
          const classified = classifyThrown(error, this.kind);
          return {
            ok: false,
            latencyMs: Date.now() - started,
            modelCount: null,
            message: classified.message,
            category: classified.category
          };
        }
      }
    };
  }
});

// src/core/providers/registry.ts
function createAdapter(profile) {
  const config = readEndpointConfig(profile);
  if (profile.providerId === "gemini" || config.apiStyle === "gemini") {
    return new GeminiAdapter(profile.providerId);
  }
  return new OpenAICompatibleAdapter(profile.providerId);
}
var init_registry = __esm({
  "src/core/providers/registry.ts"() {
    "use strict";
    init_gemini();
    init_openai_compatible();
    init_profile_config();
  }
});

// src/core/providers/catalog.ts
function inferCodingSuitability(modelId) {
  if (/coder|codex|deepseek-coder|qwen.*coder/i.test(modelId)) return 4;
  if (/o[134]|r1|reason|thinking|qwq/i.test(modelId)) return 3;
  if (/70b|120b|405b|large|pro|sonnet|opus/i.test(modelId)) return 4;
  return 2;
}
function inferReasoningSuitability(modelId) {
  if (/o[134]|r1|reason|thinking|qwq|deepseek-r/i.test(modelId)) return 4;
  if (/pro|opus|70b|120b|405b/i.test(modelId)) return 4;
  return 2;
}
function isLikelyVision(modelId) {
  return /vision|gemini|gpt-4o|gpt-4\.1|claude|llava|pixtral|qwen.*vl/i.test(modelId);
}
function hostnameOf(baseUrl) {
  if (!baseUrl) return null;
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return null;
  }
}
function isExplicitlyFreeModel(modelId) {
  return /:free$/i.test(modelId) || /(?:^|[/:-])free(?:$|[/:-])/i.test(modelId);
}
function classifyDiscoveredAccess(providerId, model, hints = {}) {
  const inputPrice = model.inputPricePerMillion;
  const outputPrice = model.outputPricePerMillion;
  const isZeroPriced = inputPrice !== null && inputPrice !== void 0 && outputPrice !== null && outputPrice !== void 0 && inputPrice === 0 && outputPrice === 0;
  if (isExplicitlyFreeModel(model.modelId) || isZeroPriced) {
    return {
      access: "free-confirmed",
      source: "provider-model-catalog",
      notes: "The provider catalog lists this variant at zero prompt/completion price or marks it as free. Limits and availability can change."
    };
  }
  if (providerId === "gemini" || providerId === "groq") {
    const priced = (inputPrice ?? 0) > 0 || (outputPrice ?? 0) > 0;
    return {
      access: "free-tier",
      source: priced ? "provider-model-catalog" : "provider-model-list",
      notes: priced ? "Listed with paid-plan per-token pricing; the provider free tier covers this model under rate limits." : "The provider publishes a free developer tier for this model. Limits are controlled by the provider."
    };
  }
  if ((inputPrice ?? 0) > 0 || (outputPrice ?? 0) > 0) {
    return {
      access: "paid",
      source: providerId === "openrouter" ? "openrouter-model-catalog" : "provider-model-catalog",
      notes: "The provider publishes non-zero per-token pricing for this model."
    };
  }
  if (providerId === "openrouter") {
    return { access: "unknown", source: "openrouter-model-catalog", notes: null };
  }
  if (providerId === "openai") {
    return {
      access: "paid",
      source: "provider-documentation",
      notes: "OpenAI API usage is billed by OpenAI. Check your account billing settings."
    };
  }
  const host = hostnameOf(hints.baseUrl);
  if (host) {
    if (FREE_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
      const local = /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])$/i.test(host);
      if (local) {
        return {
          access: "free-confirmed",
          source: "endpoint-documentation",
          notes: "Local/self-hosted endpoint \u2014 there is no per-token provider bill."
        };
      }
      return {
        access: "free-tier",
        source: "endpoint-documentation",
        notes: `This endpoint host (${host}) publishes a free developer tier, but some models may still be billed. Verify per-model pricing.`
      };
    }
    if (PAID_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
      return {
        access: "paid",
        source: "endpoint-documentation",
        notes: `This endpoint host (${host}) bills API usage directly.`
      };
    }
  }
  return { access: "unknown", source: "provider-model-list", notes: null };
}
function enrichDiscoveredModel(providerId, discovered, hints = {}) {
  const known = KNOWN_MODELS[`${providerId}:${discovered.modelId}`];
  const access = classifyDiscoveredAccess(providerId, discovered, hints);
  return {
    ...discovered,
    displayName: known?.displayName ?? discovered.displayName ?? discovered.modelId,
    contextWindow: discovered.contextWindow ?? known?.contextWindow ?? null,
    maxOutputTokens: discovered.maxOutputTokens ?? known?.maxOutputTokens ?? null,
    supportsTools: discovered.supportsTools ?? known?.supportsTools ?? true,
    supportsStreaming: discovered.supportsStreaming ?? true,
    supportsVision: discovered.supportsVision ?? known?.supportsVision ?? isLikelyVision(discovered.modelId),
    inputPricePerMillion: discovered.inputPricePerMillion ?? null,
    outputPricePerMillion: discovered.outputPricePerMillion ?? null,
    metadata: {
      ...discovered.metadata ?? {},
      codingSuitability: discovered.metadata?.codingSuitability ?? known?.codingSuitability ?? inferCodingSuitability(discovered.modelId),
      reasoningSuitability: discovered.metadata?.reasoningSuitability ?? known?.reasoningSuitability ?? inferReasoningSuitability(discovered.modelId),
      access: known?.access ?? access.access,
      accessSource: known?.access ? "provider-documentation" : access.source,
      accessNotes: known?.accessNotes ?? access.notes
    }
  };
}
function knownModelToInfo(providerId, modelId) {
  const known = KNOWN_MODELS[`${providerId}:${modelId}`];
  if (!known) return null;
  return {
    id: `${providerId}:${modelId}`,
    providerId,
    profileId: null,
    modelId,
    displayName: known.displayName,
    contextWindow: known.contextWindow ?? null,
    maxOutputTokens: known.maxOutputTokens ?? null,
    supportsTools: known.supportsTools ?? true,
    supportsStreaming: true,
    supportsVision: known.supportsVision ?? false,
    codingSuitability: known.codingSuitability ?? 2,
    reasoningSuitability: known.reasoningSuitability ?? 2,
    inputPricePerMillion: null,
    outputPricePerMillion: null,
    access: known.access ?? "unknown",
    accessSource: "provider-documentation",
    accessNotes: known.accessNotes ?? null,
    available: false,
    lastCheckedAt: null,
    userClassification: null,
    metadata: { seeded: true }
  };
}
function knownModelsForProvider(providerId) {
  return Object.keys(KNOWN_MODELS).filter((key) => key.startsWith(`${providerId}:`)).map((key) => knownModelToInfo(providerId, key.slice(providerId.length + 1))).filter((model) => model !== null);
}
function owningProfileForModel(profiles, model) {
  if (model.profileId) return profiles.find((profile) => profile.id === model.profileId) ?? null;
  return profiles.find(
    (profile) => profile.providerId === model.providerId && profile.defaultModel === model.modelId
  ) ?? profiles.find((profile) => profile.providerId === model.providerId && profile.enabled) ?? profiles.find((profile) => profile.providerId === model.providerId) ?? null;
}
function effectiveAccess(model, profileAccess = null) {
  if (model.userClassification) return model.userClassification;
  if (model.access !== "unknown") return model.access;
  if (profileAccess === "user-free" || profileAccess === "user-paid") return profileAccess;
  return "unknown";
}
function isFreeAccess(access) {
  return access === "free-confirmed" || access === "free-tier" || access === "user-free";
}
function isPaidAccess(access) {
  return access === "paid" || access === "user-paid";
}
var FREE_TIER_NOTE, KNOWN_MODELS, FREE_HOST_PATTERNS, PAID_HOST_PATTERNS, ACCESS_LABELS;
var init_catalog = __esm({
  "src/core/providers/catalog.ts"() {
    "use strict";
    FREE_TIER_NOTE = "Provider advertises a free tier with provider-controlled limits. Eligibility, models, and limits can change at any time. Verify current terms in the provider console.";
    KNOWN_MODELS = {
      "gemini:gemini-2.5-pro": {
        displayName: "Gemini 2.5 Pro",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        supportsTools: true,
        supportsVision: true,
        codingSuitability: 5,
        reasoningSuitability: 5,
        access: "free-tier",
        accessNotes: FREE_TIER_NOTE
      },
      "gemini:gemini-2.5-flash": {
        displayName: "Gemini 2.5 Flash",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        supportsTools: true,
        supportsVision: true,
        codingSuitability: 4,
        reasoningSuitability: 4,
        access: "free-tier",
        accessNotes: FREE_TIER_NOTE
      },
      "gemini:gemini-2.5-flash-lite": {
        displayName: "Gemini 2.5 Flash Lite",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        supportsTools: true,
        supportsVision: true,
        codingSuitability: 3,
        reasoningSuitability: 3,
        access: "free-tier",
        accessNotes: FREE_TIER_NOTE
      },
      "gemini:gemini-2.0-flash": {
        displayName: "Gemini 2.0 Flash",
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        supportsTools: true,
        supportsVision: true,
        codingSuitability: 3,
        reasoningSuitability: 3,
        access: "free-tier",
        accessNotes: FREE_TIER_NOTE
      },
      "gemini:gemini-2.0-flash-lite": {
        displayName: "Gemini 2.0 Flash Lite",
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        supportsTools: true,
        supportsVision: true,
        codingSuitability: 2,
        reasoningSuitability: 2,
        access: "free-tier",
        accessNotes: FREE_TIER_NOTE
      },
      "groq:llama-3.3-70b-versatile": {
        displayName: "Llama 3.3 70B Versatile",
        contextWindow: 131072,
        maxOutputTokens: 32768,
        supportsTools: true,
        codingSuitability: 3,
        reasoningSuitability: 3,
        access: "free-tier",
        accessNotes: FREE_TIER_NOTE
      },
      "groq:llama-3.1-8b-instant": {
        displayName: "Llama 3.1 8B Instant",
        contextWindow: 131072,
        maxOutputTokens: 8192,
        supportsTools: true,
        codingSuitability: 2,
        reasoningSuitability: 2,
        access: "free-tier",
        accessNotes: FREE_TIER_NOTE
      },
      "groq:openai/gpt-oss-120b": {
        displayName: "GPT-OSS 120B (Groq)",
        contextWindow: 131072,
        maxOutputTokens: 65536,
        supportsTools: true,
        codingSuitability: 4,
        reasoningSuitability: 4,
        access: "free-tier",
        accessNotes: FREE_TIER_NOTE
      },
      "groq:openai/gpt-oss-20b": {
        displayName: "GPT-OSS 20B (Groq)",
        contextWindow: 131072,
        maxOutputTokens: 65536,
        supportsTools: true,
        codingSuitability: 3,
        reasoningSuitability: 3,
        access: "free-tier",
        accessNotes: FREE_TIER_NOTE
      },
      "groq:moonshotai/kimi-k2-instruct": {
        displayName: "Kimi K2 Instruct (Groq)",
        contextWindow: 262144,
        maxOutputTokens: 16384,
        supportsTools: true,
        codingSuitability: 4,
        reasoningSuitability: 4,
        access: "free-tier",
        accessNotes: FREE_TIER_NOTE
      },
      "groq:qwen/qwen3-32b": {
        displayName: "Qwen3 32B (Groq)",
        contextWindow: 131072,
        maxOutputTokens: 40960,
        supportsTools: true,
        codingSuitability: 3,
        reasoningSuitability: 4,
        access: "free-tier",
        accessNotes: FREE_TIER_NOTE
      }
    };
    FREE_HOST_PATTERNS = [
      /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])$/i,
      /(?:^|\.)models\.github\.ai$/i,
      /(?:^|\.)huggingface\.co$/i,
      /(?:^|\.)api-inference\.modelscope\.cn$/i,
      /(?:^|\.)modelscope\.cn$/i,
      /(?:^|\.)ai\.gitee\.com$/i,
      /(?:^|\.)siliconflow\.cn$/i,
      /(?:^|\.)open\.bigmodel\.cn$/i,
      /(?:^|\.)cloudflare\.com$/i,
      /(?:^|\.)cerebras\.ai$/i,
      /(?:^|\.)integrate\.api\.nvidia\.com$/i,
      /(?:^|\.)generativelanguage\.googleapis\.com$/i,
      /(?:^|\.)api\.groq\.com$/i
    ];
    PAID_HOST_PATTERNS = [
      /(?:^|\.)api\.openai\.com$/i,
      /(?:^|\.)api\.deepseek\.com$/i,
      /(?:^|\.)api\.mistral\.ai$/i,
      /(?:^|\.)api\.x\.ai$/i,
      /(?:^|\.)api\.fireworks\.ai$/i,
      /(?:^|\.)api\.anthropic\.com$/i
    ];
    ACCESS_LABELS = {
      "free-confirmed": "Free (confirmed)",
      "free-tier": "Free tier",
      paid: "Paid",
      "user-free": "User: free",
      "user-paid": "User: paid",
      unknown: "Unknown",
      unavailable: "Unavailable"
    };
  }
});

// src/core/providers/definitions.ts
function getProviderDefinition(id) {
  return PROVIDER_DEFINITIONS[id] ?? PROVIDER_DEFINITIONS.custom;
}
function providerDisplayName(id) {
  return PROVIDER_DEFINITIONS[id]?.name ?? id;
}
var PROVIDER_DEFINITIONS, PROVIDER_ORDER, PROVIDER_PRESETS;
var init_definitions = __esm({
  "src/core/providers/definitions.ts"() {
    "use strict";
    PROVIDER_DEFINITIONS = {
      gemini: {
        id: "gemini",
        name: "Google AI Studio",
        description: "Gemini API models through Google AI Studio (generativelanguage.googleapis.com).",
        adapter: "gemini",
        defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        authType: "api-key",
        docsUrl: "https://ai.google.dev/gemini-api/docs",
        keyHint: "AIza...",
        supportsModelDiscovery: true,
        customBaseUrl: true
      },
      groq: {
        id: "groq",
        name: "Groq",
        description: "Fast OpenAI-compatible inference from GroqCloud.",
        adapter: "openai-compatible",
        defaultBaseUrl: "https://api.groq.com/openai/v1",
        authType: "bearer",
        docsUrl: "https://console.groq.com/docs",
        keyHint: "gsk_...",
        supportsModelDiscovery: true,
        customBaseUrl: true
      },
      openrouter: {
        id: "openrouter",
        name: "OpenRouter",
        description: "OpenAI-compatible gateway with many models and optional free variants.",
        adapter: "openai-compatible",
        defaultBaseUrl: "https://openrouter.ai/api/v1",
        authType: "bearer",
        docsUrl: "https://openrouter.ai/docs",
        keyHint: "sk-or-v1-...",
        supportsModelDiscovery: true,
        customBaseUrl: true
      },
      openai: {
        id: "openai",
        name: "OpenAI",
        description: "OpenAI platform API.",
        adapter: "openai-compatible",
        defaultBaseUrl: "https://api.openai.com/v1",
        authType: "bearer",
        docsUrl: "https://platform.openai.com/docs",
        keyHint: "sk-...",
        supportsModelDiscovery: true,
        customBaseUrl: true
      },
      custom: {
        id: "custom",
        name: "OpenAI-compatible endpoint",
        description: "Any server implementing the OpenAI chat completions and models APIs.",
        adapter: "openai-compatible",
        defaultBaseUrl: "",
        authType: "bearer",
        docsUrl: "https://platform.openai.com/docs/api-reference",
        keyHint: "Provider key (optional for local endpoints)",
        supportsModelDiscovery: true,
        customBaseUrl: true
      }
    };
    PROVIDER_ORDER = ["gemini", "groq", "openrouter", "openai", "custom"];
    PROVIDER_PRESETS = [
      {
        id: "deepseek",
        label: "DeepSeek",
        baseUrl: "https://api.deepseek.com/v1",
        docsUrl: "https://api-docs.deepseek.com",
        apiStyle: "openai-compatible",
        requiresKey: true,
        notes: "OpenAI-compatible API. Pricing is controlled by DeepSeek.",
        exampleModel: "deepseek-chat"
      },
      {
        id: "mistral",
        label: "Mistral AI",
        baseUrl: "https://api.mistral.ai/v1",
        docsUrl: "https://docs.mistral.ai",
        apiStyle: "openai-compatible",
        requiresKey: true,
        notes: "OpenAI-compatible chat completions.",
        exampleModel: "mistral-large-latest"
      },
      {
        id: "xai",
        label: "xAI",
        baseUrl: "https://api.x.ai/v1",
        docsUrl: "https://docs.x.ai",
        apiStyle: "openai-compatible",
        requiresKey: true,
        notes: "OpenAI-compatible API.",
        exampleModel: "grok-2-latest"
      },
      {
        id: "together",
        label: "Together AI",
        baseUrl: "https://api.together.xyz/v1",
        docsUrl: "https://docs.together.ai",
        apiStyle: "openai-compatible",
        requiresKey: true,
        notes: "OpenAI-compatible API with many open models.",
        exampleModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo"
      },
      {
        id: "fireworks",
        label: "Fireworks AI",
        baseUrl: "https://api.fireworks.ai/inference/v1",
        docsUrl: "https://docs.fireworks.ai",
        apiStyle: "openai-compatible",
        requiresKey: true,
        notes: "OpenAI-compatible inference endpoint.",
        exampleModel: "accounts/fireworks/models/llama-v3p3-70b-instruct"
      },
      {
        id: "cerebras",
        label: "Cerebras",
        baseUrl: "https://api.cerebras.ai/v1",
        docsUrl: "https://inference-docs.cerebras.ai",
        apiStyle: "openai-compatible",
        requiresKey: true,
        notes: "OpenAI-compatible inference endpoint.",
        exampleModel: "llama-3.3-70b"
      },
      {
        id: "ollama",
        label: "Ollama (local)",
        baseUrl: "http://localhost:11434/v1",
        docsUrl: "https://ollama.com",
        apiStyle: "openai-compatible",
        requiresKey: false,
        notes: "Local server. ComiCode does not run or download models; start Ollama separately.",
        exampleModel: "llama3.2"
      },
      {
        id: "lmstudio",
        label: "LM Studio (local)",
        baseUrl: "http://localhost:1234/v1",
        docsUrl: "https://lmstudio.ai/docs",
        apiStyle: "openai-compatible",
        requiresKey: false,
        notes: "Local server. Start the LM Studio server before connecting.",
        exampleModel: "local-model"
      },
      {
        id: "vllm",
        label: "vLLM / local OpenAI server",
        baseUrl: "http://localhost:8000/v1",
        docsUrl: "https://docs.vllm.ai",
        apiStyle: "openai-compatible",
        requiresKey: false,
        notes: "Any local OpenAI-compatible server can be used. No GPU is required by ComiCode itself.",
        exampleModel: "your-model"
      },
      {
        id: "azure-openai",
        label: "Azure OpenAI",
        baseUrl: "https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT",
        docsUrl: "https://learn.microsoft.com/azure/ai-services/openai",
        apiStyle: "openai-compatible",
        requiresKey: true,
        authHeader: "api-key",
        authPrefix: "",
        notes: "Use your deployment path as the base URL and set the API version query string if required. Model discovery may be unavailable.",
        exampleModel: "gpt-4o"
      },
      {
        id: "litellm",
        label: "LiteLLM proxy",
        baseUrl: "http://localhost:4000/v1",
        docsUrl: "https://docs.litellm.ai",
        apiStyle: "openai-compatible",
        requiresKey: false,
        notes: "LiteLLM can proxy many upstream providers behind one OpenAI-compatible endpoint.",
        exampleModel: "gpt-4o-mini"
      },
      {
        id: "github-models",
        label: "GitHub Models",
        baseUrl: "https://models.github.ai/inference",
        docsUrl: "https://docs.github.com/github-models",
        apiStyle: "openai-compatible",
        requiresKey: true,
        notes: "Free inference for many models with a GitHub personal access token.",
        exampleModel: "openai/gpt-4o-mini"
      },
      {
        id: "huggingface",
        label: "Hugging Face Inference",
        baseUrl: "https://router.huggingface.co/v1",
        docsUrl: "https://huggingface.co/docs/inference-providers",
        apiStyle: "openai-compatible",
        requiresKey: true,
        notes: "Free monthly credits with a Hugging Face token; huge model catalog.",
        exampleModel: "meta-llama/Llama-3.3-70B-Instruct"
      },
      {
        id: "nvidia-nim",
        label: "NVIDIA NIM",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        docsUrl: "https://build.nvidia.com",
        apiStyle: "openai-compatible",
        requiresKey: true,
        notes: "Free developer tier for NVIDIA-hosted open models.",
        exampleModel: "meta/llama-3.3-70b-instruct"
      },
      {
        id: "modelscope",
        label: "ModelScope (Alibaba)",
        baseUrl: "https://api-inference.modelscope.cn/v1",
        docsUrl: "https://modelscope.cn/docs",
        apiStyle: "openai-compatible",
        requiresKey: true,
        notes: "Free OpenAI-compatible inference for Qwen and other open models.",
        exampleModel: "Qwen/Qwen2.5-Coder-32B-Instruct"
      },
      {
        id: "gitee-ai",
        label: "Gitee AI",
        baseUrl: "https://ai.gitee.com/v1",
        docsUrl: "https://ai.gitee.com/docs",
        apiStyle: "openai-compatible",
        requiresKey: true,
        notes: "Free-tier OpenAI-compatible endpoint hosted in China.",
        exampleModel: "Qwen2.5-Coder-32B"
      },
      {
        id: "siliconflow",
        label: "SiliconFlow",
        baseUrl: "https://api.siliconflow.cn/v1",
        docsUrl: "https://siliconflow.cn",
        apiStyle: "openai-compatible",
        requiresKey: true,
        notes: "Many permanently free small models plus paid tiers.",
        exampleModel: "Qwen/Qwen2.5-Coder-32B-Instruct"
      },
      {
        id: "zhipu",
        label: "Zhipu GLM",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        docsUrl: "https://open.bigmodel.cn",
        apiStyle: "openai-compatible",
        requiresKey: true,
        notes: "GLM models; glm-4.5-flash is free.",
        exampleModel: "glm-4.5-flash"
      },
      {
        id: "cloudflare-workers-ai",
        label: "Cloudflare Workers AI",
        baseUrl: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
        docsUrl: "https://developers.cloudflare.com/workers-ai",
        apiStyle: "openai-compatible",
        requiresKey: true,
        notes: "Replace YOUR_ACCOUNT_ID with your Cloudflare account ID. Generous free tier.",
        exampleModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
      }
    ];
  }
});

// src/core/providers/service.ts
function credentialIdForProfile(profileId) {
  return `provider:${profileId}`;
}
function parseKeyPool(stored) {
  if (!stored) return [];
  const trimmed = stored.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
      }
    } catch {
    }
  }
  return trimmed ? [stored] : [];
}
function keysToSecret(keys) {
  const clean = keys.map((key) => key.trim()).filter((key) => key.length > 0);
  return clean.length > 1 ? JSON.stringify(clean) : clean[0] ?? "";
}
function parseKeyInput(raw) {
  return raw.split(/[\s,]+/).map((part) => part.trim()).filter((part) => part.length > 0);
}
async function resolveProfileCredential(profile, keyIndex = 0) {
  const config = readEndpointConfig(profile);
  const envName = profile.apiKeyEnv?.trim();
  if (envName) {
    const value = process.env[envName]?.trim() ?? "";
    if (value) {
      registerSecret(value);
      return { apiKey: value, source: "environment", keyIndex: 0, keyCount: 1 };
    }
    if (config.allowNoAuth) return { apiKey: "", source: "none", keyIndex: 0, keyCount: 1 };
    throw new ProviderError({
      providerId: profile.providerId,
      category: "invalid_api_key",
      retryable: false,
      message: `Environment variable ${envName} is not set for profile "${profile.name}".`
    });
  }
  const stored = await getCredentialStore().getSecret(credentialIdForProfile(profile.id));
  const pool = parseKeyPool(stored);
  if (pool.length > 0) {
    const index = Math.min(Math.max(0, keyIndex), pool.length - 1);
    const apiKey = pool[index];
    registerSecret(apiKey);
    return { apiKey, source: "credential-store", keyIndex: index, keyCount: pool.length };
  }
  if (config.allowNoAuth) return { apiKey: "", source: "none", keyIndex: 0, keyCount: 1 };
  throw new ProviderError({
    providerId: profile.providerId,
    category: "invalid_api_key",
    retryable: false,
    message: `No API key is configured for profile "${profile.name}". Connect it with "comicode auth set".`
  });
}
async function createProfileContext(profile, keyIndex = 0) {
  const credential = await resolveProfileCredential(profile, keyIndex);
  return {
    profile,
    apiKey: credential.apiKey,
    baseUrl: profile.baseUrl || getProviderDefinition(profile.providerId).defaultBaseUrl,
    keyIndex: credential.keyIndex,
    keyCount: credential.keyCount
  };
}
async function refreshProfileModels(store, profile, options = {}) {
  const started = Date.now();
  const context = await createProfileContext(profile);
  context.signal = options.signal;
  const adapter = createAdapter(profile);
  try {
    const discovered = await adapter.listModels(context);
    const enriched = discovered.map(
      (model) => enrichDiscoveredModel(profile.providerId, model, {
        baseUrl: profile.baseUrl,
        profileName: profile.name
      })
    );
    const scopedProfileId = profile.providerId === "custom" ? profile.id : null;
    store.upsertModels(profile.providerId, enriched, scopedProfileId);
    store.markProviderModelsStale(
      profile.providerId,
      enriched.map((model) => model.modelId),
      scopedProfileId ?? ""
    );
    const latencyMs = Date.now() - started;
    store.updateProfile(profile.id, {
      modelsRefreshedAt: (/* @__PURE__ */ new Date()).toISOString(),
      lastCheckedAt: (/* @__PURE__ */ new Date()).toISOString(),
      lastSuccessAt: (/* @__PURE__ */ new Date()).toISOString(),
      lastError: null
    });
    store.recordHealth({ profileId: profile.id, ok: true, latencyMs });
    store.clearLimitsForProfile(profile.id);
    return { models: enriched, discovered: enriched.length, latencyMs };
  } catch (error) {
    const classified = classifyThrown(error, profile.providerId);
    store.updateProfile(profile.id, {
      lastCheckedAt: (/* @__PURE__ */ new Date()).toISOString(),
      lastError: classified.message,
      lastErrorAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    store.recordHealth({
      profileId: profile.id,
      ok: false,
      latencyMs: Date.now() - started,
      category: classified.category,
      message: classified.message
    });
    throw classified;
  }
}
async function testProfileConnection(store, profile, options = {}) {
  const started = Date.now();
  try {
    const context = await createProfileContext(profile);
    const adapter = createAdapter(profile);
    const result = await adapter.testConnection(context);
    const latency = result.latencyMs || Date.now() - started;
    if (options.persistStatus !== false) {
      store.recordHealth({
        profileId: profile.id,
        ok: result.ok,
        latencyMs: latency,
        category: result.category ?? null,
        message: result.message
      });
      if (result.ok) {
        store.recordProfileSuccess(profile.id);
        store.updateProfile(profile.id, { lastError: null, lastErrorAt: null });
        store.clearLimitsForProfile(profile.id);
      } else {
        const safe = redactSecrets(result.message);
        store.recordProfileError(profile.id, safe);
      }
    }
    return { ...result, message: redactSecrets(result.message) };
  } catch (error) {
    const classified = classifyThrown(error, profile.providerId);
    if (options.persistStatus !== false) {
      store.recordHealth({
        profileId: profile.id,
        ok: false,
        latencyMs: Date.now() - started,
        category: classified.category,
        message: classified.message
      });
      store.recordProfileError(profile.id, classified.message);
    }
    return {
      ok: false,
      latencyMs: Date.now() - started,
      modelCount: null,
      message: classified.message,
      category: classified.category
    };
  }
}
function seedKnownCatalog(store) {
  const providerIds = new Set(
    store.listProfiles().map((profile) => profile.providerId)
  );
  for (const providerId of providerIds) {
    for (const model of knownModelsForProvider(providerId)) {
      store.seedModel(providerId, model);
    }
  }
}
async function addManualModel(store, profile, modelId) {
  const trimmed = modelId.trim();
  if (!trimmed) throw new Error("Model ID is required.");
  const discovered = {
    modelId: trimmed,
    displayName: trimmed,
    supportsTools: true,
    supportsStreaming: true,
    metadata: { manual: true }
  };
  const enriched = enrichDiscoveredModel(profile.providerId, discovered, {
    baseUrl: profile.baseUrl,
    profileName: profile.name
  });
  const scopedProfileId = profile.providerId === "custom" ? profile.id : null;
  store.upsertModels(profile.providerId, [enriched], scopedProfileId);
  store.updateProfile(profile.id, { lastCheckedAt: (/* @__PURE__ */ new Date()).toISOString() });
  logger.info(`Added manual model ${trimmed} for profile ${profile.name}.`);
}
async function removeProfile(store, profileId) {
  const profile = store.getProfile(profileId);
  if (!profile) return;
  if (profile.providerId === "custom") {
    for (const model of store.listModels(profile.providerId, profile.id)) {
      if (model.profileId === profile.id) store.deleteModel(model.id);
    }
  }
  await getCredentialStore().deleteSecret(credentialIdForProfile(profileId));
  store.deleteProfile(profileId);
}
function exportProviders(store) {
  return {
    version: 1,
    exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    generator: "comicode",
    profiles: store.listProfiles().map((profile) => ({
      providerId: profile.providerId,
      name: profile.name,
      baseUrl: profile.baseUrl,
      authType: profile.authType,
      defaultModel: profile.defaultModel,
      apiKeyEnv: profile.apiKeyEnv,
      enabled: profile.enabled,
      accessClassification: profile.accessClassification,
      config: profile.config
    }))
  };
}
function importProviders(store, raw) {
  const summary = { created: 0, updated: 0, skipped: 0, warnings: [] };
  const record = raw && typeof raw === "object" ? raw : {};
  if (record.version !== 1)
    summary.warnings.push("Unknown export version; attempting best-effort import.");
  const profiles = Array.isArray(record.profiles) ? record.profiles : [];
  for (const entry of profiles) {
    if (!entry || typeof entry !== "object") {
      summary.skipped += 1;
      continue;
    }
    const item = entry;
    const providerId = String(item.providerId ?? "custom");
    const name = String(item.name ?? "").trim();
    if (!name) {
      summary.skipped += 1;
      summary.warnings.push("Skipped a profile without a name.");
      continue;
    }
    if ("apiKey" in item || "api_key" in item) {
      summary.warnings.push(`Ignored embedded API key for profile "${name}".`);
    }
    const config = item.config && typeof item.config === "object" ? item.config : {};
    const existing = store.findProfile(providerId, name);
    const baseUrl = String(item.baseUrl ?? getProviderDefinition(providerId).defaultBaseUrl);
    const authType = item.authType === "api-key" ? "api-key" : "bearer";
    if (existing) {
      store.updateProfile(existing.id, {
        baseUrl,
        authType,
        defaultModel: item.defaultModel ? String(item.defaultModel) : existing.defaultModel,
        apiKeyEnv: item.apiKeyEnv ? String(item.apiKeyEnv) : existing.apiKeyEnv,
        enabled: item.enabled === false ? false : existing.enabled,
        accessClassification: typeof item.accessClassification === "string" ? item.accessClassification : existing.accessClassification,
        config
      });
      summary.updated += 1;
    } else {
      store.createProfile({
        providerId,
        name,
        baseUrl,
        authType,
        defaultModel: item.defaultModel ? String(item.defaultModel) : null,
        apiKeyEnv: item.apiKeyEnv ? String(item.apiKeyEnv) : null,
        enabled: item.enabled !== false,
        accessClassification: typeof item.accessClassification === "string" ? item.accessClassification : "unknown",
        config
      });
      summary.created += 1;
    }
  }
  seedKnownCatalog(store);
  return summary;
}
var init_service = __esm({
  "src/core/providers/service.ts"() {
    "use strict";
    init_credentials();
    init_redact();
    init_logger();
    init_registry();
    init_catalog();
    init_errors();
    init_profile_config();
    init_definitions();
  }
});

// src/core/settings.ts
import { z as z2 } from "zod";
function parseSettings(raw) {
  const merged = deepMerge(DEFAULT_SETTINGS, raw);
  return SettingsSchema.parse(merged);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function deepMerge(base, override) {
  if (!isRecord(override)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isRecord(value) && isRecord(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else if (value !== void 0) {
      out[key] = value;
    }
  }
  return out;
}
var ACCESS_CLASSIFICATIONS, AccessClassificationSchema, RoutingPolicySchema, AgentSettingsSchema, SettingsSchema, DEFAULT_SETTINGS, SETTING_PATHS;
var init_settings = __esm({
  "src/core/settings.ts"() {
    "use strict";
    ACCESS_CLASSIFICATIONS = [
      "free-confirmed",
      "free-tier",
      "paid",
      "user-free",
      "user-paid",
      "unknown",
      "unavailable"
    ];
    AccessClassificationSchema = z2.enum([
      "free-confirmed",
      "free-tier",
      "paid",
      "user-free",
      "user-paid",
      "unknown",
      "unavailable"
    ]);
    RoutingPolicySchema = z2.object({
      /** Prefer models classified as free when choosing a fallback. */
      preferFree: z2.boolean().default(true),
      /** Try other profiles of the same provider before moving to another provider. */
      preferSameProvider: z2.boolean().default(true),
      /** Bias selection toward models with stronger coding metadata. */
      preferCoding: z2.boolean().default(true),
      /** Allow fallback to models classified as paid. Explicit selections are still honored. */
      allowPaid: z2.boolean().default(false),
      /** Allow fallback to models with unknown pricing/access. */
      allowUnknownAccess: z2.boolean().default(true),
      /** Maximum fallback candidates considered per routing pass. */
      maxFallbacks: z2.number().int().min(1).max(20).default(4),
      /** Maximum retry attempts against a single candidate (excluding retry-after waits). */
      maxRetriesPerCandidate: z2.number().int().min(0).max(5).default(1),
      /** Base delay for exponential backoff, in milliseconds. */
      retryBaseDelayMs: z2.number().int().min(100).max(6e4).default(1e3),
      /** Maximum backoff delay, in milliseconds. */
      retryMaxDelayMs: z2.number().int().min(100).max(3e5).default(3e4),
      /** Provider IDs to prefer, in order. */
      preferredProviders: z2.array(z2.string()).default([]),
      /** Provider IDs that must never be selected. */
      excludedProviders: z2.array(z2.string()).default([]),
      /** Minimum context window required for fallback models. */
      minContextWindow: z2.number().int().min(0).default(0)
    });
    AgentSettingsSchema = z2.object({
      maxSteps: z2.number().int().min(1).max(200).default(30),
      /** Fraction of the model context window that may be used for prompt context. */
      contextBudgetRatio: z2.number().min(0.2).max(0.9).default(0.45),
      maxToolOutputChars: z2.number().int().min(1e3).max(2e5).default(12e3),
      autoApproveReadOnly: z2.boolean().default(true),
      autoApproveFileEdits: z2.boolean().default(false),
      autoApproveCommands: z2.boolean().default(false),
      allowSecretAccess: z2.boolean().default(false),
      /**
       * How the agent asks for approval:
       * - `ask`: prompt for every sensitive action (per-action "always allow" grants still apply).
       * - `trusted`: auto-approve file edits and normal commands; still ask for dangerous commands and secrets.
       * - `auto`: never prompt; only hard safety blocks apply.
       */
      permissionMode: z2.enum(["ask", "trusted", "auto"]).default("ask"),
      /**
       * Persistent "always allow" grants chosen in approval dialogs.
       * Commands match exactly or by trailing `*` prefix; paths are
       * project-relative and also match everything beneath them.
       */
      permissions: z2.object({
        allowCommands: z2.array(z2.string()).default([]),
        allowPaths: z2.array(z2.string()).default([])
      }).prefault({}),
      testCommand: z2.string().nullable().default(null),
      lintCommand: z2.string().nullable().default(null),
      buildCommand: z2.string().nullable().default(null),
      /** Optional command that visually verifies UI work (e.g. a screenshot/a11y script). */
      uiVerifyCommand: z2.string().nullable().default(null),
      collaboration: z2.object({
        enabled: z2.boolean().default(false),
        plannerProfileId: z2.string().nullable().default(null),
        reviewerProfileId: z2.string().nullable().default(null),
        testerProfileId: z2.string().nullable().default(null),
        reviewChanges: z2.boolean().default(true)
      }).prefault({})
    });
    SettingsSchema = z2.object({
      theme: z2.enum(["dark", "dark-dim"]).default("dark"),
      accent: z2.enum(["cyan", "blue", "green", "magenta", "orange"]).default("cyan"),
      ui: z2.object({
        /** Shortcut id to binding string, for example { model: "ctrl+g" }. */
        shortcuts: z2.record(z2.string(), z2.string()).default({}),
        /** Color theme name — see THEMES in src/tui/theme.ts. */
        theme: z2.string().default("obsidian"),
        /**
         * Mouse reporting for wheel-scroll/click. Off by default: mouse capture
         * prevents the terminal's native highlight/copy, and keyboard scrolling
         * (pgup/pgdn, ctrl+↑/↓) always works. Enable it in settings if wheel
         * scrolling matters more — then use Shift+drag or ctrl+y to copy.
         */
        mouseScroll: z2.boolean().default(true)
      }).prefault({}),
      routing: RoutingPolicySchema.prefault({}),
      agent: AgentSettingsSchema.prefault({}),
      privacy: z2.object({
        /** ComiCode sends no telemetry. This field documents the guarantee. */
        telemetry: z2.literal(false).default(false)
      }).prefault({}),
      storage: z2.object({
        /** Days to keep completed/failed tasks before /cleanup removes them. */
        retentionDays: z2.number().int().min(1).max(3650).default(30)
      }).prefault({})
    });
    DEFAULT_SETTINGS = SettingsSchema.parse({});
    SETTING_PATHS = [
      "routing.preferFree",
      "routing.preferSameProvider",
      "routing.preferCoding",
      "routing.allowPaid",
      "routing.allowUnknownAccess",
      "routing.maxFallbacks",
      "routing.maxRetriesPerCandidate",
      "routing.retryBaseDelayMs",
      "routing.retryMaxDelayMs",
      "routing.minContextWindow",
      "routing.preferredProviders",
      "routing.excludedProviders",
      "agent.maxSteps",
      "agent.contextBudgetRatio",
      "agent.maxToolOutputChars",
      "agent.autoApproveReadOnly",
      "agent.autoApproveFileEdits",
      "agent.autoApproveCommands",
      "agent.allowSecretAccess",
      "agent.permissionMode",
      "agent.permissions.allowCommands",
      "agent.permissions.allowPaths",
      "storage.retentionDays",
      "agent.testCommand",
      "agent.lintCommand",
      "agent.buildCommand",
      "agent.uiVerifyCommand",
      "agent.collaboration.enabled",
      "agent.collaboration.plannerProfileId",
      "agent.collaboration.reviewerProfileId",
      "agent.collaboration.testerProfileId",
      "agent.collaboration.reviewChanges",
      "theme",
      "accent",
      "ui.mouseScroll"
    ];
  }
});

// src/core/security/masking.ts
import { createHash, timingSafeEqual } from "crypto";
function maskSecret(secret) {
  if (!secret) return "(not set)";
  const trimmed = secret.trim();
  if (trimmed.length === 0) return "(not set)";
  if (trimmed.length <= 8) return "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
  return `\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022${trimmed.slice(-4)}`;
}
var init_masking = __esm({
  "src/core/security/masking.ts"() {
    "use strict";
  }
});

// src/cli/output.ts
var output_exports = {};
__export(output_exports, {
  accent: () => accent,
  accessLabel: () => accessLabel,
  bold: () => bold,
  danger: () => danger,
  dim: () => dim,
  formatDateTime: () => formatDateTime,
  formatNumber: () => formatNumber,
  formatRelative: () => formatRelative,
  formatTokens: () => formatTokens,
  jsonOut: () => jsonOut,
  printKeyValue: () => printKeyValue,
  printSection: () => printSection,
  printTable: () => printTable,
  printTitle: () => printTitle,
  statusLabel: () => statusLabel,
  stripAnsi: () => stripAnsi,
  success: () => success,
  supportsColor: () => supportsColor,
  truncate: () => truncate,
  warning: () => warning
});
import chalk from "chalk";
function supportsColor() {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
}
function bold(text) {
  return supportsColor() ? chalk.bold(text) : text;
}
function dim(text) {
  return supportsColor() ? chalk.dim(text) : text;
}
function accent(text) {
  return supportsColor() ? chalk.cyan(text) : text;
}
function success(text) {
  return supportsColor() ? chalk.green(text) : text;
}
function warning(text) {
  return supportsColor() ? chalk.yellow(text) : text;
}
function danger(text) {
  return supportsColor() ? chalk.red(text) : text;
}
function printTitle(title, subtitle) {
  console.log("");
  console.log(bold(`COMICODE`) + (subtitle ? `  ${dim(subtitle)}` : ""));
  console.log(
    dim("\u2500".repeat(Math.min(72, Math.max(20, title.length + (subtitle?.length ?? 0) + 10))))
  );
  console.log(bold(title));
}
function printSection(title) {
  console.log("");
  console.log(bold(title));
}
function printKeyValue(rows) {
  const width = Math.min(28, Math.max(...rows.map(([key]) => key.length), 0));
  for (const [key, value] of rows) {
    console.log(`${dim(key.padEnd(width))}  ${value}`);
  }
}
function printTable(headers, rows, options = {}) {
  if (rows.length === 0) {
    console.log(dim("  (none)"));
    return;
  }
  const widths = headers.map(
    (header, index) => Math.min(
      index === headers.length - 1 ? 80 : 36,
      Math.max(header.length, ...rows.map((row) => stripAnsi(row[index] ?? "").length))
    )
  );
  const renderRow = (cells) => cells.map((cell, index) => {
    const plain = stripAnsi(cell);
    const clipped = plain.length > widths[index] ? `${plain.slice(0, widths[index] - 1)}\u2026` : plain;
    const colorized = cell.includes("\x1B") ? cell : clipped;
    const visibleLength = stripAnsi(colorized).length;
    return colorized + " ".repeat(Math.max(0, widths[index] - visibleLength));
  }).join("  ").trimEnd();
  console.log(dim(renderRow(headers)));
  console.log(dim(widths.map((width) => "\u2500".repeat(width)).join("  ")));
  for (const row of rows) console.log(renderRow(row));
  void options;
}
function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}
function formatNumber(value) {
  return value.toLocaleString("en-US");
}
function formatTokens(count) {
  if (!Number.isFinite(count)) return "0";
  if (count >= 1e6) return `${(count / 1e6).toFixed(2)}M`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)}K`;
  return String(count);
}
function formatDateTime(iso) {
  if (!iso) return "\u2014";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}
function formatRelative(iso) {
  if (!iso) return "never";
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  const diff = Date.now() - time;
  if (diff < 0) return `in ${Math.ceil(-diff / 6e4)}m`;
  if (diff < 6e4) return "just now";
  if (diff < 36e5) return `${Math.floor(diff / 6e4)}m ago`;
  if (diff < 864e5) return `${Math.floor(diff / 36e5)}h ago`;
  return `${Math.floor(diff / 864e5)}d ago`;
}
function statusLabel(status) {
  switch (status) {
    case "completed":
      return success("completed");
    case "running":
      return accent("running");
    case "paused":
      return warning("paused");
    case "failed":
      return danger("failed");
    case "cancelled":
      return dim("cancelled");
    default:
      return status;
  }
}
function accessLabel(access) {
  switch (access) {
    case "free-confirmed":
    case "user-free":
      return success(access === "user-free" ? "user:free" : "free");
    case "free-tier":
      return accent("free-tier");
    case "paid":
    case "user-paid":
      return warning("paid");
    case "unavailable":
      return danger("unavailable");
    default:
      return dim("unknown");
  }
}
function truncate(text, max = 80) {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length > max ? `${singleLine.slice(0, max - 1)}\u2026` : singleLine;
}
function jsonOut(value) {
  console.log(JSON.stringify(value, null, 2));
}
var init_output = __esm({
  "src/cli/output.ts"() {
    "use strict";
  }
});

// src/cli/prompt.ts
import { stdin, stdout } from "process";
import readline from "readline";
function isInteractive() {
  return Boolean(stdin.isTTY) && Boolean(stdout.isTTY);
}
function requireInteractive(action) {
  if (!isInteractive()) {
    throw new Error(
      `${action} requires an interactive terminal. Pass explicit flags for non-interactive use (see --help).`
    );
  }
}
function validateValue(value, options) {
  if (options.required && !value.trim()) return "A value is required.";
  return options.validate?.(value) ?? null;
}
async function promptText(question, options = {}) {
  requireInteractive("This prompt");
  const suffix = options.defaultValue ? dim(` [${options.defaultValue}]`) : "";
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    terminal: true
  });
  try {
    for (; ; ) {
      const answer = await new Promise((resolve6) => {
        rl.question(`${bold("?")} ${question}${suffix} `, resolve6);
      });
      const value = answer.trim() || options.defaultValue || "";
      if (!value && options.allowEmpty) return "";
      const error = validateValue(value, options);
      if (error) {
        stdout.write(`${danger("\u2716")} ${error}
`);
        continue;
      }
      return value;
    }
  } finally {
    rl.close();
  }
}
async function promptSecret(question) {
  requireInteractive("Secret input");
  stdout.write(`${bold("?")} ${question} `);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode?.(true);
  stdin.resume();
  return new Promise((resolve6, reject) => {
    let value = "";
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      stdin.removeListener("data", onData2);
      stdin.setRawMode?.(wasRaw ?? false);
      stdin.pause();
      stdout.write("\n");
    };
    const finish = () => {
      cleanup();
      resolve6(value);
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    const onData2 = (chunk) => {
      const text = chunk.toString("utf8");
      for (const char of text) {
        if (char === "") {
          stdout.write(dim(" (cancelled)"));
          fail(new Error("Cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          finish();
          return;
        }
        if (char === "\x7F" || char === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        if (char === "\x1B") {
          continue;
        }
        if (char >= " ") {
          value += char;
          stdout.write("*");
        }
      }
    };
    stdin.on("data", onData2);
  });
}
async function promptChoice(question, choices, options = {}) {
  requireInteractive("This prompt");
  if (choices.length === 0) throw new Error("No choices are available.");
  stdout.write(`
${bold(question)}
`);
  choices.forEach((choice, index) => {
    const marker = options.defaultIndex === index ? success("\u203A") : dim(String(index + 1).padStart(2, " "));
    const hint = choice.hint ? dim(`  ${choice.hint}`) : "";
    stdout.write(`  ${marker} ${choice.label}${hint}
`);
  });
  for (; ; ) {
    const answer = await promptText(
      `Choose 1-${choices.length}${options.defaultIndex !== void 0 ? ` (default ${options.defaultIndex + 1})` : ""}:`,
      {
        defaultValue: options.defaultIndex !== void 0 ? String(options.defaultIndex + 1) : void 0,
        validate: (value) => {
          const index = Number(value);
          if (!Number.isInteger(index) || index < 1 || index > choices.length) {
            return `Enter a number between 1 and ${choices.length}.`;
          }
          return null;
        }
      }
    );
    const selected = choices[Number(answer) - 1];
    if (selected) return selected.value;
  }
}
async function promptConfirm(question, defaultValue = false) {
  requireInteractive("This confirmation");
  const hint = defaultValue ? "Y/n" : "y/N";
  for (; ; ) {
    const answer = await promptText(`${question} (${hint})`, { allowEmpty: true });
    const normalized = answer.trim().toLowerCase();
    if (!normalized) return defaultValue;
    if (["y", "yes"].includes(normalized)) return true;
    if (["n", "no"].includes(normalized)) return false;
    stdout.write(`${danger("\u2716")} Please answer yes or no.
`);
  }
}
var init_prompt = __esm({
  "src/cli/prompt.ts"() {
    "use strict";
    init_output();
  }
});

// src/core/db/schema.ts
var SCHEMA_VERSION, SCHEMA_SQL;
var init_schema = __esm({
  "src/core/db/schema.ts"() {
    "use strict";
    SCHEMA_VERSION = 1;
    SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_profiles (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL,
  default_model TEXT,
  api_key_env TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  access_classification TEXT NOT NULL DEFAULT 'unknown',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error TEXT,
  last_error_at TEXT,
  last_checked_at TEXT,
  models_refreshed_at TEXT,
  UNIQUE(provider_id, name)
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  profile_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  context_window INTEGER,
  max_output_tokens INTEGER,
  supports_tools INTEGER NOT NULL DEFAULT 0,
  supports_streaming INTEGER NOT NULL DEFAULT 1,
  supports_vision INTEGER NOT NULL DEFAULT 0,
  coding_suitability INTEGER NOT NULL DEFAULT 2,
  reasoning_suitability INTEGER NOT NULL DEFAULT 2,
  input_price_per_million REAL,
  output_price_per_million REAL,
  access TEXT NOT NULL DEFAULT 'unknown',
  access_source TEXT NOT NULL DEFAULT 'catalog',
  access_notes TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  last_checked_at TEXT,
  user_classification TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(provider_id, profile_id, model_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  project_name TEXT NOT NULL,
  user_request TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'coding',
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  plan_json TEXT,
  completed_steps_json TEXT NOT NULL DEFAULT '[]',
  pending_steps_json TEXT NOT NULL DEFAULT '[]',
  relevant_files_json TEXT NOT NULL DEFAULT '[]',
  changed_files_json TEXT NOT NULL DEFAULT '[]',
  current_profile_id TEXT,
  current_model_id TEXT,
  attempts_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  summary TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  resume_count INTEGER NOT NULL DEFAULT 0,
  last_checkpoint_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_updated ON tasks(project_path, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS task_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls_json TEXT,
  tool_call_id TEXT,
  name TEXT,
  is_error INTEGER NOT NULL DEFAULT 0,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_task_seq ON task_messages(task_id, seq);

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_task_seq ON checkpoints(task_id, seq DESC);

CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  profile_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_estimate REAL,
  source TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_profile ON usage_events(profile_id);

CREATE TABLE IF NOT EXISTS provider_limits (
  profile_id TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT '*',
  category TEXT NOT NULL,
  message TEXT,
  retry_after_at TEXT,
  reset_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(profile_id, model_id)
);

CREATE TABLE IF NOT EXISTS routing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  from_profile_id TEXT,
  from_model_id TEXT,
  to_profile_id TEXT,
  to_model_id TEXT,
  reason TEXT NOT NULL,
  category TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_routing_task ON routing_events(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_health (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL,
  ok INTEGER NOT NULL,
  latency_ms INTEGER,
  category TEXT,
  message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_health_profile ON provider_health(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS project_cache (
  project_path TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
  }
});

// src/core/db/database.ts
import { dirname as dirname3 } from "path";
import { mkdirSync as mkdirSync4 } from "fs";
function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
var sqlite, DatabaseSync, Db;
var init_database = __esm({
  "src/core/db/database.ts"() {
    "use strict";
    init_schema();
    sqlite = process.getBuiltinModule("node:sqlite");
    DatabaseSync = sqlite.DatabaseSync;
    Db = class {
      raw;
      constructor(path) {
        if (path !== ":memory:") {
          mkdirSync4(dirname3(path), { recursive: true, mode: 448 });
        }
        this.raw = new DatabaseSync(path);
        this.raw.exec("PRAGMA foreign_keys = ON;");
        this.raw.exec("PRAGMA busy_timeout = 5000;");
        if (path !== ":memory:") {
          this.raw.exec("PRAGMA journal_mode = WAL;");
          this.raw.exec("PRAGMA synchronous = NORMAL;");
        }
        this.migrate();
      }
      migrate() {
        this.raw.exec(SCHEMA_SQL);
        const current = this.metaGet("schema_version");
        if (!current) {
          this.metaSet("schema_version", String(SCHEMA_VERSION));
        }
      }
      metaGet(key) {
        const row = this.get("SELECT value FROM meta WHERE key = ?", key);
        return row?.value ?? null;
      }
      metaSet(key, value) {
        this.run(
          "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          key,
          value
        );
      }
      all(sql, ...params) {
        const statement = this.raw.prepare(sql);
        return statement.all(...params);
      }
      get(sql, ...params) {
        const statement = this.raw.prepare(sql);
        return statement.get(...params);
      }
      run(sql, ...params) {
        const statement = this.raw.prepare(sql);
        const result = statement.run(...params);
        return {
          changes: Number(result.changes),
          lastInsertRowid: result.lastInsertRowid
        };
      }
      transaction(fn) {
        this.raw.exec("BEGIN IMMEDIATE");
        try {
          const value = fn();
          this.raw.exec("COMMIT");
          return value;
        } catch (error) {
          try {
            this.raw.exec("ROLLBACK");
          } catch {
          }
          throw error;
        }
      }
      close() {
        try {
          this.raw.close();
        } catch {
        }
      }
    };
  }
});

// src/core/types.ts
var TASK_PHASES;
var init_types = __esm({
  "src/core/types.ts"() {
    "use strict";
    TASK_PHASES = [
      "intake",
      "inspect",
      "plan",
      "implement",
      "test",
      "review",
      "summarize",
      "paused",
      "done"
    ];
  }
});

// src/core/db/store.ts
import { randomUUID as randomUUID3 } from "crypto";
import { statSync as statSync2 } from "fs";
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function mapProfile(row) {
  return {
    id: str(row.id),
    providerId: str(row.provider_id),
    name: str(row.name),
    baseUrl: str(row.base_url),
    authType: row.auth_type === "bearer" ? "bearer" : "api-key",
    defaultModel: nullableStr(row.default_model),
    apiKeyEnv: nullableStr(row.api_key_env),
    enabled: bool(row.enabled),
    accessClassification: str(row.access_classification),
    config: safeJsonParse(str(row.config_json), {}),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    lastSuccessAt: nullableStr(row.last_success_at),
    lastError: nullableStr(row.last_error),
    lastErrorAt: nullableStr(row.last_error_at),
    lastCheckedAt: nullableStr(row.last_checked_at),
    modelsRefreshedAt: nullableStr(row.models_refreshed_at)
  };
}
function mapModel(row) {
  return {
    id: str(row.id),
    providerId: str(row.provider_id),
    profileId: nullableStr(row.profile_id),
    modelId: str(row.model_id),
    displayName: str(row.display_name),
    contextWindow: nullableNum(row.context_window),
    maxOutputTokens: nullableNum(row.max_output_tokens),
    supportsTools: bool(row.supports_tools),
    supportsStreaming: bool(row.supports_streaming),
    supportsVision: bool(row.supports_vision),
    codingSuitability: num(row.coding_suitability),
    reasoningSuitability: num(row.reasoning_suitability),
    inputPricePerMillion: nullableNum(row.input_price_per_million),
    outputPricePerMillion: nullableNum(row.output_price_per_million),
    access: str(row.access),
    accessSource: str(row.access_source),
    accessNotes: nullableStr(row.access_notes),
    available: bool(row.available),
    lastCheckedAt: nullableStr(row.last_checked_at),
    userClassification: nullableStr(row.user_classification) ?? null,
    metadata: safeJsonParse(str(row.metadata_json), {})
  };
}
function mapTask(row) {
  const planRaw = nullableStr(row.plan_json);
  const metadata = safeJsonParse(str(row.metadata_json), {});
  return {
    id: str(row.id),
    projectPath: str(row.project_path),
    projectName: str(row.project_name),
    userRequest: str(row.user_request),
    taskType: str(row.task_type) || "coding",
    status: str(row.status),
    phase: TASK_PHASES.includes(str(row.phase)) ? str(row.phase) : "intake",
    plan: planRaw ? safeJsonParse(planRaw, null) : null,
    completedSteps: safeJsonParse(str(row.completed_steps_json), []),
    pendingSteps: safeJsonParse(str(row.pending_steps_json), []),
    relevantFiles: safeJsonParse(str(row.relevant_files_json), []),
    changedFiles: safeJsonParse(str(row.changed_files_json), []),
    currentProfileId: nullableStr(row.current_profile_id),
    currentModelId: nullableStr(row.current_model_id),
    attempts: safeJsonParse(str(row.attempts_json), []),
    metadata,
    summary: nullableStr(row.summary),
    error: nullableStr(row.error),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    completedAt: nullableStr(row.completed_at),
    resumeCount: num(row.resume_count),
    lastCheckpointId: nullableStr(row.last_checkpoint_id)
  };
}
function mapMessage(row) {
  return {
    id: num(row.id),
    taskId: str(row.task_id),
    seq: num(row.seq),
    role: str(row.role),
    content: str(row.content),
    toolCalls: safeJsonParse(
      row.tool_calls_json ? str(row.tool_calls_json) : null,
      null
    ),
    toolCallId: nullableStr(row.tool_call_id),
    name: nullableStr(row.name),
    isError: bool(row.is_error),
    tokenEstimate: num(row.token_estimate),
    createdAt: str(row.created_at)
  };
}
function mapLimit(row, nowMs = Date.now()) {
  const limit = {
    profileId: str(row.profile_id),
    modelId: str(row.model_id),
    category: str(row.category),
    message: nullableStr(row.message),
    retryAfterAt: nullableStr(row.retry_after_at),
    resetAt: nullableStr(row.reset_at),
    attempts: num(row.attempts),
    updatedAt: str(row.updated_at),
    active: false
  };
  limit.active = isLimitActive(limit, nowMs);
  return limit;
}
function isLimitActive(limit, nowMs = Date.now()) {
  const retry = limit.retryAfterAt ? Date.parse(limit.retryAfterAt) : NaN;
  const reset = limit.resetAt ? Date.parse(limit.resetAt) : NaN;
  if (Number.isFinite(retry) && retry > nowMs) return true;
  if (Number.isFinite(reset) && reset > nowMs) return true;
  if (Number.isFinite(retry) || Number.isFinite(reset)) return false;
  const updated = Date.parse(limit.updatedAt);
  if (!Number.isFinite(updated)) return false;
  const cooldown = limit.category === "daily_quota" || limit.category === "billing_restriction" ? 30 * 6e4 : 2 * 6e4;
  return nowMs - updated < cooldown;
}
function openStore(path) {
  return new Store(path);
}
var str, nullableStr, num, nullableNum, bool, Store;
var init_store = __esm({
  "src/core/db/store.ts"() {
    "use strict";
    init_database();
    init_settings();
    init_catalog();
    init_definitions();
    init_types();
    str = (value) => typeof value === "string" ? value : "";
    nullableStr = (value) => typeof value === "string" && value.length > 0 ? value : null;
    num = (value) => typeof value === "number" ? value : Number(value ?? 0);
    nullableNum = (value) => value === null || value === void 0 ? null : Number(value);
    bool = (value) => Number(value) === 1;
    Store = class {
      constructor(path) {
        this.path = path;
        this.db = new Db(path);
        this.applyNativeSelectionDefault();
        this.applyMouseScrollDefault();
        this.applyMouseScrollDefaultV3();
        this.applyMouseScrollDefaultV4();
        this.reclassifyModelAccess();
      }
      path;
      db;
      /**
       * v3 turned wheel scroll off by default, but users want it on; copy remains
       * available via ctrl+y select mode and Shift+drag where supported.
       */
      applyMouseScrollDefaultV4() {
        if (this.db.metaGet("ui.mouse_scroll_default_v4")) return;
        const settings = this.getSettings();
        if (!settings.ui.mouseScroll) {
          settings.ui.mouseScroll = true;
          this.saveSettings(settings);
        }
        this.db.metaSet("ui.mouse_scroll_default_v4", "1");
      }
      /**
       * v2 re-enabled wheel scrolling by default, but users kept reporting that
       * plain drag-selection broke. Keyboard-first default wins: mouse capture
       * stays off unless the user explicitly enables it in settings.
       */
      applyMouseScrollDefaultV3() {
        if (this.db.metaGet("ui.mouse_scroll_default_v3")) return;
        const settings = this.getSettings();
        if (settings.ui.mouseScroll) {
          settings.ui.mouseScroll = false;
          this.saveSettings(settings);
        }
        this.db.metaSet("ui.mouse_scroll_default_v3", "1");
      }
      /**
       * The first selection-default migration forced mouseScroll off as a
       * workaround for stale mouse-capture modes, which are now cleared properly
       * on startup. Re-enable wheel scrolling once; users who prefer native
       * selection can turn it back off in settings.
       */
      applyMouseScrollDefault() {
        if (this.db.metaGet("ui.mouse_scroll_default_v2")) return;
        const settings = this.getSettings();
        if (!settings.ui.mouseScroll) {
          settings.ui.mouseScroll = true;
          this.saveSettings(settings);
        }
        this.db.metaSet("ui.mouse_scroll_default_v2", "1");
      }
      /**
       * One-time migration: model access labels stored by older builds used
       * host-level heuristics that marked every model on a free-tier host as
       * "free-confirmed". Recompute access from the same classifier used at
       * discovery time so paid models stop showing as free. Rows with an explicit
       * user classification are left untouched.
       */
      reclassifyModelAccess() {
        if (this.db.metaGet("models.access_reclassified_v2")) return;
        const rows = this.db.all(
          `SELECT id, provider_id, profile_id, model_id, input_price_per_million,
              output_price_per_million
       FROM models WHERE user_classification IS NULL`
        );
        const profileUrls = /* @__PURE__ */ new Map();
        for (const row of rows) {
          const providerId = row.provider_id;
          let baseUrl = getProviderDefinition(providerId).defaultBaseUrl;
          if (row.profile_id) {
            if (!profileUrls.has(row.profile_id)) {
              const profile = this.db.get(
                "SELECT base_url FROM provider_profiles WHERE id = ?",
                row.profile_id
              );
              profileUrls.set(row.profile_id, profile?.base_url ?? "");
            }
            baseUrl = profileUrls.get(row.profile_id) || baseUrl;
          }
          const classified = classifyDiscoveredAccess(
            providerId,
            {
              modelId: row.model_id,
              displayName: row.model_id,
              inputPricePerMillion: row.input_price_per_million,
              outputPricePerMillion: row.output_price_per_million
            },
            { baseUrl }
          );
          this.db.run(
            "UPDATE models SET access = ?, access_source = ?, access_notes = ? WHERE id = ?",
            classified.access,
            classified.source,
            classified.notes,
            row.id
          );
        }
        this.db.metaSet("models.access_reclassified_v2", "1");
      }
      /**
       * Older builds enabled mouse capture by default, which blocked native text
       * selection. Force it off once per database; users can re-enable it from
       * settings afterwards.
       */
      applyNativeSelectionDefault() {
        if (this.db.metaGet("ui.native_selection_default")) return;
        const row = this.db.get("SELECT json FROM settings WHERE id = 1");
        if (row) {
          const settings = this.getSettings();
          if (settings.ui.mouseScroll) {
            settings.ui.mouseScroll = false;
            this.saveSettings(settings);
          }
        }
        this.db.metaSet("ui.native_selection_default", "1");
      }
      close() {
        this.db.close();
      }
      // ---------------------------------------------------------------- settings
      getSettings() {
        const row = this.db.get("SELECT json FROM settings WHERE id = 1");
        return row ? parseSettings(safeJsonParse(row.json, {})) : parseSettings({});
      }
      saveSettings(settings) {
        const validated = parseSettings(settings);
        this.db.run(
          `INSERT INTO settings(id, json, updated_at) VALUES(1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
          JSON.stringify(validated),
          nowIso()
        );
      }
      updateSettings(mutator) {
        const current = this.getSettings();
        const result = mutator(structuredClone(current)) ?? current;
        this.saveSettings(result);
        return this.getSettings();
      }
      // ----------------------------------------------------------- project cache
      getProjectSnapshot(projectPath) {
        const row = this.db.get(
          "SELECT snapshot_json, updated_at FROM project_cache WHERE project_path = ?",
          projectPath
        );
        if (!row) return null;
        return { snapshot: safeJsonParse(row.snapshot_json, null), updatedAt: row.updated_at };
      }
      saveProjectSnapshot(projectPath, snapshot) {
        this.db.run(
          `INSERT INTO project_cache(project_path, snapshot_json, updated_at) VALUES(?, ?, ?)
       ON CONFLICT(project_path) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`,
          projectPath,
          JSON.stringify(snapshot),
          nowIso()
        );
      }
      // --------------------------------------------------------------- providers
      listProfiles(providerId) {
        const rows = providerId ? this.db.all(
          "SELECT * FROM provider_profiles WHERE provider_id = ? ORDER BY provider_id, name COLLATE NOCASE",
          providerId
        ) : this.db.all(
          "SELECT * FROM provider_profiles ORDER BY provider_id, name COLLATE NOCASE"
        );
        return rows.map(mapProfile);
      }
      getProfile(id) {
        const row = this.db.get("SELECT * FROM provider_profiles WHERE id = ?", id);
        return row ? mapProfile(row) : null;
      }
      findProfile(providerId, name) {
        const row = this.db.get(
          "SELECT * FROM provider_profiles WHERE provider_id = ? AND name = ? COLLATE NOCASE",
          providerId,
          name
        );
        return row ? mapProfile(row) : null;
      }
      createProfile(input) {
        const timestamp = nowIso();
        const id = randomUUID3();
        this.db.run(
          `INSERT INTO provider_profiles(
        id, provider_id, name, base_url, auth_type, default_model, api_key_env,
        enabled, access_classification, config_json, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          input.providerId,
          input.name,
          input.baseUrl,
          input.authType,
          input.defaultModel ?? null,
          input.apiKeyEnv ?? null,
          input.enabled === false ? 0 : 1,
          input.accessClassification ?? "unknown",
          JSON.stringify(input.config ?? {}),
          timestamp,
          timestamp
        );
        const profile = this.getProfile(id);
        if (!profile) throw new Error("Failed to create provider profile.");
        return profile;
      }
      updateProfile(id, patch) {
        const current = this.getProfile(id);
        if (!current) throw new Error(`Provider profile not found: ${id}`);
        const merged = { ...current, ...patch, id: current.id, updatedAt: nowIso() };
        this.db.run(
          `UPDATE provider_profiles SET
        name = ?, base_url = ?, auth_type = ?, default_model = ?, api_key_env = ?,
        enabled = ?, access_classification = ?, config_json = ?, updated_at = ?,
        last_success_at = ?, last_error = ?, last_error_at = ?, last_checked_at = ?,
        models_refreshed_at = ?
       WHERE id = ?`,
          merged.name,
          merged.baseUrl,
          merged.authType,
          merged.defaultModel,
          merged.apiKeyEnv,
          merged.enabled ? 1 : 0,
          merged.accessClassification,
          JSON.stringify(merged.config),
          merged.updatedAt,
          merged.lastSuccessAt,
          merged.lastError,
          merged.lastErrorAt,
          merged.lastCheckedAt,
          merged.modelsRefreshedAt,
          id
        );
        return this.getProfile(id);
      }
      deleteProfile(id) {
        this.db.transaction(() => {
          this.db.run("DELETE FROM provider_profiles WHERE id = ?", id);
          this.db.run("DELETE FROM provider_limits WHERE profile_id = ?", id);
          this.db.run("DELETE FROM provider_health WHERE profile_id = ?", id);
          if (this.getSelectedProfileId() === id) this.setSelectedProfileId(null);
        });
      }
      recordProfileSuccess(id) {
        const timestamp = nowIso();
        this.db.run(
          "UPDATE provider_profiles SET last_success_at = ?, last_checked_at = ?, last_error = NULL WHERE id = ?",
          timestamp,
          timestamp,
          id
        );
      }
      recordProfileError(id, message) {
        const timestamp = nowIso();
        this.db.run(
          "UPDATE provider_profiles SET last_error = ?, last_error_at = ?, last_checked_at = ? WHERE id = ?",
          message,
          timestamp,
          timestamp,
          id
        );
      }
      // ------------------------------------------------------------------ models
      upsertModels(providerId, models, profileId = null) {
        const timestamp = nowIso();
        const scope = profileId ?? "";
        const scopePrefix = scope ? `${scope}:` : "";
        this.db.transaction(() => {
          for (const model of models) {
            const id = `${providerId}:${scopePrefix}${model.modelId}`;
            this.db.run(
              `INSERT INTO models(
            id, provider_id, profile_id, model_id, display_name, context_window, max_output_tokens,
            supports_tools, supports_streaming, supports_vision, coding_suitability,
            reasoning_suitability, input_price_per_million, output_price_per_million,
            access, access_source, access_notes, available, last_checked_at, metadata_json
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT(provider_id, profile_id, model_id) DO UPDATE SET
            display_name = excluded.display_name,
            context_window = COALESCE(excluded.context_window, models.context_window),
            max_output_tokens = COALESCE(excluded.max_output_tokens, models.max_output_tokens),
            supports_tools = excluded.supports_tools,
            supports_streaming = excluded.supports_streaming,
            supports_vision = excluded.supports_vision,
            coding_suitability = excluded.coding_suitability,
            reasoning_suitability = excluded.reasoning_suitability,
            input_price_per_million = COALESCE(excluded.input_price_per_million, models.input_price_per_million),
            output_price_per_million = COALESCE(excluded.output_price_per_million, models.output_price_per_million),
            access = excluded.access,
            access_source = excluded.access_source,
            access_notes = excluded.access_notes,
            available = 1,
            last_checked_at = excluded.last_checked_at,
            metadata_json = excluded.metadata_json`,
              id,
              providerId,
              scope,
              model.modelId,
              model.displayName,
              model.contextWindow ?? null,
              model.maxOutputTokens ?? null,
              model.supportsTools === false ? 0 : 1,
              model.supportsStreaming === false ? 0 : 1,
              model.supportsVision ? 1 : 0,
              model.metadata?.codingSuitability ?? 2,
              model.metadata?.reasoningSuitability ?? 2,
              model.inputPricePerMillion ?? null,
              model.outputPricePerMillion ?? null,
              model.metadata?.access ?? "unknown",
              String(model.metadata?.accessSource ?? "provider-model-list"),
              model.metadata?.accessNotes ?? null,
              timestamp,
              JSON.stringify(model.metadata ?? {})
            );
          }
        });
        return this.listModels(providerId);
      }
      /** Insert catalog metadata without marking a model as remotely discovered. */
      seedModel(providerId, model) {
        this.db.run(
          `INSERT INTO models(
        id, provider_id, profile_id, model_id, display_name, context_window, max_output_tokens,
        supports_tools, supports_streaming, supports_vision, coding_suitability,
        reasoning_suitability, input_price_per_million, output_price_per_million,
        access, access_source, access_notes, available, last_checked_at, metadata_json
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
          model.id,
          model.providerId,
          model.profileId ?? "",
          model.modelId,
          model.displayName,
          model.contextWindow,
          model.maxOutputTokens,
          model.supportsTools ? 1 : 0,
          model.supportsStreaming ? 1 : 0,
          model.supportsVision ? 1 : 0,
          model.codingSuitability,
          model.reasoningSuitability,
          model.inputPricePerMillion,
          model.outputPricePerMillion,
          model.access,
          model.accessSource,
          model.accessNotes,
          model.available ? 1 : 0,
          model.lastCheckedAt,
          JSON.stringify(model.metadata)
        );
      }
      listModels(providerId, profileId) {
        let rows;
        if (providerId) {
          rows = this.db.all(
            "SELECT * FROM models WHERE provider_id = ? ORDER BY coding_suitability DESC, model_id",
            providerId
          );
          if (profileId !== void 0) {
            rows = rows.filter((row) => {
              const scope = nullableStr(row.profile_id);
              return profileId === null ? scope === null : scope === null || scope === profileId;
            });
          }
        } else {
          rows = this.db.all(
            "SELECT * FROM models ORDER BY provider_id, coding_suitability DESC, model_id"
          );
        }
        return rows.map(mapModel);
      }
      getModel(providerId, modelId, profileId = null) {
        const row = this.db.get(
          "SELECT * FROM models WHERE provider_id = ? AND profile_id = ? AND model_id = ?",
          providerId,
          profileId ?? "",
          modelId
        );
        return row ? mapModel(row) : null;
      }
      getModelById(id) {
        const row = this.db.get("SELECT * FROM models WHERE id = ?", id);
        return row ? mapModel(row) : null;
      }
      setUserClassification(id, classification) {
        this.db.run("UPDATE models SET user_classification = ? WHERE id = ?", classification, id);
      }
      setModelAvailable(providerId, modelId, available) {
        this.db.run(
          "UPDATE models SET available = ?, last_checked_at = ? WHERE provider_id = ? AND model_id = ?",
          available ? 1 : 0,
          nowIso(),
          providerId,
          modelId
        );
      }
      markProviderModelsStale(providerId, exceptIds = [], profileScope = "") {
        const placeholders = exceptIds.map(() => "?").join(",");
        const scopeClause = "AND profile_id = ?";
        const params = [providerId, ...exceptIds, profileScope];
        if (exceptIds.length === 0) {
          this.db.run(
            `UPDATE models SET available = 0 WHERE provider_id = ? ${scopeClause}`,
            providerId,
            profileScope
          );
          return;
        }
        this.db.run(
          `UPDATE models SET available = 0 WHERE provider_id = ? AND model_id NOT IN (${placeholders}) ${scopeClause}`,
          ...params
        );
      }
      deleteModel(id) {
        this.db.run("DELETE FROM models WHERE id = ?", id);
      }
      // --------------------------------------------------------------- selection
      getSelectedProfileId() {
        const value = this.db.metaGet("ui.selected_profile_id");
        return value ? value : null;
      }
      setSelectedProfileId(id) {
        this.db.metaSet("ui.selected_profile_id", id ?? "");
      }
      getSelectedModelId() {
        const value = this.db.metaGet("ui.selected_model_id");
        return value ? value : null;
      }
      /** When the user last picked a model (ISO timestamp), or null. */
      getSelectedModelChangedAt() {
        const value = this.db.metaGet("ui.selected_model_at");
        return value ? value : null;
      }
      setSelectedModelId(id) {
        this.db.metaSet("ui.selected_model_id", id ?? "");
        this.db.metaSet("ui.selected_model_at", id ? nowIso() : "");
      }
      // ------------------------------------------------------------------- tasks
      createTask(input) {
        const id = randomUUID3();
        const timestamp = nowIso();
        this.db.run(
          `INSERT INTO tasks(
        id, project_path, project_name, user_request, task_type, status, phase,
        pending_steps_json, metadata_json, current_profile_id, current_model_id,
        created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, 'running', 'intake', '[]', ?, ?, ?, ?, ?)`,
          id,
          input.projectPath,
          input.projectName,
          input.userRequest,
          input.taskType ?? "coding",
          JSON.stringify(input.metadata ?? {}),
          input.currentProfileId ?? null,
          input.currentModelId ?? null,
          timestamp,
          timestamp
        );
        return this.getTask(id);
      }
      getTask(id) {
        const row = this.db.get("SELECT * FROM tasks WHERE id = ?", id);
        return row ? mapTask(row) : null;
      }
      updateTask(id, patch) {
        const current = this.getTask(id);
        if (!current) throw new Error(`Task not found: ${id}`);
        const merged = { ...current, ...patch, id: current.id, updatedAt: nowIso() };
        this.db.run(
          `UPDATE tasks SET
        status = ?, phase = ?, plan_json = ?, completed_steps_json = ?, pending_steps_json = ?,
        relevant_files_json = ?, changed_files_json = ?, current_profile_id = ?, current_model_id = ?,
        attempts_json = ?, metadata_json = ?, summary = ?, error = ?, updated_at = ?,
        completed_at = ?, resume_count = ?, last_checkpoint_id = ?, task_type = ?
       WHERE id = ?`,
          merged.status,
          merged.phase,
          merged.plan ? JSON.stringify(merged.plan) : null,
          JSON.stringify(merged.completedSteps),
          JSON.stringify(merged.pendingSteps),
          JSON.stringify(merged.relevantFiles),
          JSON.stringify(merged.changedFiles),
          merged.currentProfileId,
          merged.currentModelId,
          JSON.stringify(merged.attempts),
          JSON.stringify(merged.metadata),
          merged.summary,
          merged.error,
          merged.updatedAt,
          merged.completedAt,
          merged.resumeCount,
          merged.lastCheckpointId,
          merged.taskType,
          id
        );
        return this.getTask(id);
      }
      addAttempt(id, attempt) {
        const task = this.getTask(id);
        if (!task) throw new Error(`Task not found: ${id}`);
        const attempts = [...task.attempts, attempt].slice(-100);
        return this.updateTask(id, { attempts });
      }
      listTasks(options = {}) {
        const limit = options.limit ?? 50;
        if (options.projectPath && options.statuses?.length) {
          const placeholders = options.statuses.map(() => "?").join(",");
          return this.db.all(
            `SELECT * FROM tasks WHERE project_path = ? AND status IN (${placeholders})
           ORDER BY updated_at DESC LIMIT ?`,
            options.projectPath,
            ...options.statuses,
            limit
          ).map(mapTask);
        }
        if (options.projectPath) {
          return this.db.all(
            "SELECT * FROM tasks WHERE project_path = ? ORDER BY updated_at DESC LIMIT ?",
            options.projectPath,
            limit
          ).map(mapTask);
        }
        if (options.statuses?.length) {
          const placeholders = options.statuses.map(() => "?").join(",");
          return this.db.all(
            `SELECT * FROM tasks WHERE status IN (${placeholders}) ORDER BY updated_at DESC LIMIT ?`,
            ...options.statuses,
            limit
          ).map(mapTask);
        }
        return this.db.all("SELECT * FROM tasks ORDER BY updated_at DESC LIMIT ?", limit).map(mapTask);
      }
      latestResumableTask(projectPath) {
        const row = this.db.get(
          `SELECT * FROM tasks WHERE project_path = ? AND status IN ('paused','failed','running')
       ORDER BY updated_at DESC LIMIT 1`,
          projectPath
        );
        return row ? mapTask(row) : null;
      }
      deleteTask(id) {
        this.db.transaction(() => {
          this.db.run("DELETE FROM task_messages WHERE task_id = ?", id);
          this.db.run("DELETE FROM checkpoints WHERE task_id = ?", id);
          this.db.run("DELETE FROM usage_events WHERE task_id = ?", id);
          this.db.run("DELETE FROM routing_events WHERE task_id = ?", id);
          this.db.run("DELETE FROM tasks WHERE id = ?", id);
        });
      }
      /** Row counts per table plus the on-disk size of the database file. */
      storageStats() {
        const tables = [
          "meta",
          "settings",
          "provider_profiles",
          "models",
          "tasks",
          "task_messages",
          "checkpoints",
          "usage_events",
          "provider_limits",
          "routing_events",
          "provider_health"
        ];
        const counts = {};
        for (const table of tables) {
          const row = this.db.get(`SELECT COUNT(*) AS n FROM ${table}`);
          counts[table] = Number(row?.n ?? 0);
        }
        let dbBytes = 0;
        try {
          dbBytes = statSync2(this.path).size;
        } catch {
        }
        return { path: this.path, tables: counts, dbBytes };
      }
      /**
       * Delete completed/failed tasks older than `days` (with their messages,
       * checkpoints, and events) and vacuum the database. Paused/running tasks are
       * never touched.
       */
      cleanupCompletedOlderThan(days) {
        const cutoff = new Date(Date.now() - days * 864e5).toISOString();
        const rows = this.db.all(
          `SELECT id FROM tasks
       WHERE status IN ('completed', 'failed') AND updated_at < ?`,
          cutoff
        );
        this.db.transaction(() => {
          for (const row of rows) this.deleteTask(row.id);
        });
        try {
          this.db.run("VACUUM");
        } catch {
        }
        return { deletedTasks: rows.length };
      }
      appendMessage(taskId, message) {
        const seqRow = this.db.get(
          "SELECT COALESCE(MAX(seq), 0) AS seq FROM task_messages WHERE task_id = ?",
          taskId
        );
        const seq = Number(seqRow?.seq ?? 0) + 1;
        const timestamp = nowIso();
        const toolCalls = message.role === "assistant" && message.toolCalls?.length ? message.toolCalls : null;
        const toolCallId = message.role === "tool" ? message.toolCallId : null;
        const name = message.role === "tool" ? message.name : null;
        const isError = message.role === "tool" && message.isError ? 1 : 0;
        const content = message.content ?? "";
        this.db.run(
          `INSERT INTO task_messages(
        task_id, seq, role, content, tool_calls_json, tool_call_id, name, is_error, token_estimate, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          taskId,
          seq,
          message.role,
          content,
          toolCalls ? JSON.stringify(toolCalls) : null,
          toolCallId,
          name,
          isError,
          Math.ceil(content.length / 4) + (toolCalls ? Math.ceil(JSON.stringify(toolCalls).length / 4) : 0),
          timestamp
        );
        const row = this.db.get(
          "SELECT * FROM task_messages WHERE task_id = ? AND seq = ?",
          taskId,
          seq
        );
        return mapMessage(row);
      }
      loadMessages(taskId, limit = 500) {
        const rows = this.db.all(
          "SELECT * FROM task_messages WHERE task_id = ? ORDER BY seq ASC LIMIT ?",
          taskId,
          limit
        );
        return rows.map((row) => {
          const message = mapMessage(row);
          if (message.role === "assistant") {
            return {
              role: "assistant",
              content: message.content,
              ...message.toolCalls?.length ? { toolCalls: message.toolCalls } : {}
            };
          }
          if (message.role === "tool") {
            return {
              role: "tool",
              toolCallId: message.toolCallId ?? "",
              name: message.name ?? "tool",
              content: message.content,
              isError: message.isError
            };
          }
          if (message.role === "system") return { role: "system", content: message.content };
          return { role: "user", content: message.content };
        });
      }
      loadStoredMessages(taskId, limit = 500) {
        return this.db.all(
          "SELECT * FROM task_messages WHERE task_id = ? ORDER BY seq ASC LIMIT ?",
          taskId,
          limit
        ).map(mapMessage);
      }
      /** Load messages newer than a compaction cutoff. */
      loadMessagesAfter(taskId, afterSeq, limit = 500) {
        const rows = this.db.all(
          "SELECT * FROM task_messages WHERE task_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
          taskId,
          afterSeq,
          limit
        );
        return rows.map((row) => {
          const message = mapMessage(row);
          if (message.role === "assistant") {
            return {
              role: "assistant",
              content: message.content,
              ...message.toolCalls?.length ? { toolCalls: message.toolCalls } : {}
            };
          }
          if (message.role === "tool") {
            return {
              role: "tool",
              toolCallId: message.toolCallId ?? "",
              name: message.name ?? "tool",
              content: message.content,
              isError: message.isError
            };
          }
          if (message.role === "system") return { role: "system", content: message.content };
          return { role: "user", content: message.content };
        });
      }
      messageTokenEstimate(taskId) {
        const row = this.db.get(
          "SELECT COALESCE(SUM(token_estimate), 0) AS total FROM task_messages WHERE task_id = ?",
          taskId
        );
        return Number(row?.total ?? 0);
      }
      // ------------------------------------------------------------- checkpoints
      createCheckpoint(taskId, state) {
        const id = randomUUID3();
        const timestamp = nowIso();
        const seqRow = this.db.get(
          "SELECT COALESCE(MAX(seq), 0) AS seq FROM checkpoints WHERE task_id = ?",
          taskId
        );
        const seq = Number(seqRow?.seq ?? 0) + 1;
        const stateJson = JSON.stringify({ ...state, savedAt: timestamp });
        this.db.transaction(() => {
          this.db.run(
            "INSERT INTO checkpoints(id, task_id, seq, state_json, created_at) VALUES(?, ?, ?, ?, ?)",
            id,
            taskId,
            seq,
            stateJson,
            timestamp
          );
          this.db.run("UPDATE tasks SET last_checkpoint_id = ? WHERE id = ?", id, taskId);
          this.db.run(
            `DELETE FROM checkpoints WHERE task_id = ? AND seq <= ?`,
            taskId,
            Math.max(0, seq - 30)
          );
        });
        return {
          id,
          taskId,
          seq,
          state: { ...state, savedAt: timestamp },
          createdAt: timestamp
        };
      }
      latestCheckpoint(taskId) {
        const row = this.db.get(
          "SELECT * FROM checkpoints WHERE task_id = ? ORDER BY seq DESC LIMIT 1",
          taskId
        );
        if (!row) return null;
        return {
          id: str(row.id),
          taskId: str(row.task_id),
          seq: num(row.seq),
          state: safeJsonParse(str(row.state_json), {}),
          createdAt: str(row.created_at)
        };
      }
      listCheckpoints(taskId, limit = 20) {
        return this.db.all(
          "SELECT * FROM checkpoints WHERE task_id = ? ORDER BY seq DESC LIMIT ?",
          taskId,
          limit
        ).map((row) => ({
          id: str(row.id),
          taskId: str(row.task_id),
          seq: num(row.seq),
          state: safeJsonParse(str(row.state_json), {}),
          createdAt: str(row.created_at)
        }));
      }
      // ------------------------------------------------------------------- usage
      recordUsage(input) {
        this.db.run(
          `INSERT INTO usage_events(
        task_id, profile_id, provider_id, model_id, input_tokens, output_tokens,
        cost_estimate, source, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          input.taskId ?? null,
          input.profileId,
          input.providerId,
          input.modelId,
          input.inputTokens,
          input.outputTokens,
          input.costEstimate ?? null,
          input.source ?? "agent",
          nowIso()
        );
      }
      usageTotals(sinceIso) {
        const row = sinceIso ? this.db.get(
          `SELECT COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o,
             SUM(cost_estimate) AS c, COUNT(*) AS n FROM usage_events WHERE created_at >= ?`,
          sinceIso
        ) : this.db.get(
          `SELECT COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o,
             SUM(cost_estimate) AS c, COUNT(*) AS n FROM usage_events`
        );
        return {
          inputTokens: num(row?.i),
          outputTokens: num(row?.o),
          cost: row?.c === null || row?.c === void 0 ? null : Number(row.c),
          events: num(row?.n)
        };
      }
      usageByModel(sinceIso) {
        const rows = sinceIso ? this.db.all(
          `SELECT provider_id, model_id, profile_id, SUM(input_tokens) AS i,
             SUM(output_tokens) AS o, COUNT(*) AS n, SUM(cost_estimate) AS c
           FROM usage_events WHERE created_at >= ?
           GROUP BY provider_id, model_id, profile_id ORDER BY (SUM(input_tokens)+SUM(output_tokens)) DESC`,
          sinceIso
        ) : this.db.all(
          `SELECT provider_id, model_id, profile_id, SUM(input_tokens) AS i,
             SUM(output_tokens) AS o, COUNT(*) AS n, SUM(cost_estimate) AS c
           FROM usage_events
           GROUP BY provider_id, model_id, profile_id ORDER BY (SUM(input_tokens)+SUM(output_tokens)) DESC`
        );
        return rows.map((row) => ({
          providerId: str(row.provider_id),
          modelId: str(row.model_id),
          profileId: str(row.profile_id),
          inputTokens: num(row.i),
          outputTokens: num(row.o),
          events: num(row.n),
          costEstimate: row.c === null || row.c === void 0 ? null : Number(row.c)
        }));
      }
      // ------------------------------------------------------------------ limits
      saveLimit(input) {
        const timestamp = nowIso();
        this.db.run(
          `INSERT INTO provider_limits(
        profile_id, model_id, category, message, retry_after_at, reset_at, attempts, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(profile_id, model_id) DO UPDATE SET
        category = excluded.category, message = excluded.message,
        retry_after_at = excluded.retry_after_at, reset_at = excluded.reset_at,
        attempts = provider_limits.attempts + 1, updated_at = excluded.updated_at`,
          input.profileId,
          input.modelId ?? "*",
          input.category,
          input.message ?? null,
          input.retryAfterAt ?? null,
          input.resetAt ?? null,
          timestamp
        );
      }
      clearLimit(profileId, modelId) {
        this.db.run(
          "DELETE FROM provider_limits WHERE profile_id = ? AND model_id = ?",
          profileId,
          modelId ?? "*"
        );
      }
      /**
       * Remove every stored limit for a profile, including model-scoped cooldowns.
       * A successful connection test or catalog refresh proves the credentials and
       * endpoint are reachable, so stale model limits must not quarantine the
       * profile on the next run.
       */
      clearLimitsForProfile(profileId) {
        return this.db.run("DELETE FROM provider_limits WHERE profile_id = ?", profileId).changes;
      }
      clearExpiredLimits(nowMs = Date.now()) {
        const rows = this.db.all("SELECT * FROM provider_limits");
        let removed = 0;
        for (const row of rows) {
          const limit = mapLimit(row, nowMs);
          if (!limit.active) {
            this.db.run(
              "DELETE FROM provider_limits WHERE profile_id = ? AND model_id = ?",
              limit.profileId,
              limit.modelId
            );
            removed += 1;
          }
        }
        return removed;
      }
      listLimits(activeOnly = false) {
        const limits2 = this.db.all("SELECT * FROM provider_limits ORDER BY updated_at DESC").map((row) => mapLimit(row));
        return activeOnly ? limits2.filter((limit) => limit.active) : limits2;
      }
      getLimit(profileId, modelId) {
        const row = this.db.get(
          "SELECT * FROM provider_limits WHERE profile_id = ? AND model_id = ?",
          profileId,
          modelId ?? "*"
        );
        return row ? mapLimit(row) : null;
      }
      // ----------------------------------------------------------------- routing
      recordRoutingEvent(input) {
        this.db.run(
          `INSERT INTO routing_events(
        task_id, from_profile_id, from_model_id, to_profile_id, to_model_id, reason, category, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
          input.taskId ?? null,
          input.fromProfileId ?? null,
          input.fromModelId ?? null,
          input.toProfileId ?? null,
          input.toModelId ?? null,
          input.reason,
          input.category ?? null,
          nowIso()
        );
      }
      listRoutingEvents(limit = 50) {
        return this.db.all("SELECT * FROM routing_events ORDER BY created_at DESC LIMIT ?", limit).map((row) => ({
          id: num(row.id),
          taskId: nullableStr(row.task_id),
          fromProfileId: nullableStr(row.from_profile_id),
          fromModelId: nullableStr(row.from_model_id),
          toProfileId: nullableStr(row.to_profile_id),
          toModelId: nullableStr(row.to_model_id),
          reason: str(row.reason),
          category: nullableStr(row.category),
          createdAt: str(row.created_at)
        }));
      }
      // ------------------------------------------------------------------ health
      recordHealth(input) {
        this.db.run(
          "INSERT INTO provider_health(profile_id, ok, latency_ms, category, message, created_at) VALUES(?, ?, ?, ?, ?, ?)",
          input.profileId,
          input.ok ? 1 : 0,
          input.latencyMs ?? null,
          input.category ?? null,
          input.message ?? null,
          nowIso()
        );
      }
      listHealth(profileId, limit = 10) {
        return this.db.all(
          "SELECT * FROM provider_health WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?",
          profileId,
          limit
        ).map((row) => ({
          id: num(row.id),
          profileId: str(row.profile_id),
          ok: bool(row.ok),
          latencyMs: nullableNum(row.latency_ms),
          category: nullableStr(row.category),
          message: nullableStr(row.message),
          createdAt: str(row.created_at)
        }));
      }
      // --------------------------------------------------------------- summaries
      buildResumeSummary(taskId, projectState) {
        const task = this.getTask(taskId);
        if (!task) return null;
        const stored = this.loadStoredMessages(taskId, 200);
        const recentTools = stored.filter((message) => message.role === "tool").slice(-6).map((message) => `${message.name}: ${message.content.slice(0, 400)}`);
        return {
          taskId: task.id,
          userRequest: task.userRequest,
          phase: task.phase,
          completedSteps: task.completedSteps,
          pendingSteps: task.pendingSteps,
          changedFiles: task.changedFiles,
          recentTools,
          projectState,
          currentModel: task.currentModelId
        };
      }
      // ----------------------------------------------------------------- general
      stats() {
        const count = (table) => {
          const row = this.db.get(`SELECT COUNT(*) AS n FROM ${table}`);
          return num(row?.n);
        };
        let bytes = 0;
        try {
          bytes = statSync2(this.path).size;
        } catch {
          bytes = 0;
        }
        return {
          profiles: count("provider_profiles"),
          models: count("models"),
          tasks: count("tasks"),
          pausedTasks: count("tasks WHERE status = 'paused'"),
          databasePath: this.path,
          databaseBytes: bytes
        };
      }
      deleteAllData() {
        this.db.transaction(() => {
          this.db.run("DELETE FROM usage_events");
          this.db.run("DELETE FROM routing_events");
          this.db.run("DELETE FROM provider_health");
          this.db.run("DELETE FROM provider_limits");
          this.db.run("DELETE FROM checkpoints");
          this.db.run("DELETE FROM task_messages");
          this.db.run("DELETE FROM tasks");
          this.db.run("DELETE FROM models");
          this.db.run("DELETE FROM provider_profiles");
          this.db.run("DELETE FROM settings");
          this.db.run(
            "DELETE FROM meta WHERE key IN ('ui.selected_profile_id','ui.selected_model_id','ui.selected_model_at')"
          );
        });
      }
    };
  }
});

// src/core/app.ts
function ensureSelection(store) {
  const profiles = store.listProfiles();
  if (profiles.length === 0) return;
  const selectedId = store.getSelectedProfileId();
  const selected = selectedId ? profiles.find((profile) => profile.id === selectedId) : null;
  if (!selected || !selected.enabled) {
    const fallback = profiles.filter((profile) => profile.enabled).sort((a, b) => (b.lastSuccessAt ?? "").localeCompare(a.lastSuccessAt ?? ""))[0] ?? profiles[0];
    if (fallback) store.setSelectedProfileId(fallback.id);
  }
}
function openAppContext(cwd = process.cwd()) {
  ensureComicodeHome();
  const store = openStore(getDatabasePath());
  seedKnownCatalog(store);
  store.clearExpiredLimits();
  ensureSelection(store);
  return {
    store,
    cwd,
    settings: store.getSettings(),
    close: () => store.close()
  };
}
var init_app = __esm({
  "src/core/app.ts"() {
    "use strict";
    init_store();
    init_paths();
    init_service();
  }
});

// src/core/agent/skills.ts
import { existsSync as existsSync4, readdirSync, readFileSync as readFileSync3, statSync as statSync3 } from "fs";
import { join as join4, basename } from "path";
function parseSkillFile(path, source) {
  let raw;
  try {
    raw = readFileSync3(path, "utf8");
  } catch {
    return null;
  }
  const name = basename(path.replace(/\.md$/i, "")) === "SKILL" ? basename(join4(path, "..")) : basename(path).replace(/\.md$/i, "");
  let description = "";
  let content = raw;
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (frontmatter) {
    content = raw.slice(frontmatter[0].length);
    for (const line of frontmatter[1].split(/\r?\n/)) {
      const match = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
      if (!match) continue;
      if (match[1] === "name") continue;
      if (match[1] === "description") description = match[2].trim();
    }
  }
  if (!description) {
    const heading = content.match(/^#\s+(.+)$/m);
    const firstLine = content.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("#") && !line.startsWith("---"));
    description = (heading?.[1] ?? firstLine ?? name).slice(0, 200);
  }
  return { name, description, content: content.trim(), source, path };
}
function scanSkillDir(dir, source, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join4(dir, entry);
    let stat;
    try {
      stat = statSync3(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      const skillFile = join4(full, "SKILL.md");
      if (existsSync4(skillFile)) {
        const skill = parseSkillFile(skillFile, source);
        if (skill) out.push(skill);
      }
      continue;
    }
    if (entry.toLowerCase() === "skill.md" || entry.toLowerCase().endsWith(".md")) {
      const skill = parseSkillFile(full, source);
      if (skill) out.push(skill);
    }
  }
}
function loadSkills(root) {
  const byName = /* @__PURE__ */ new Map();
  for (const builtin of BUILTIN_SKILLS) {
    byName.set(builtin.name, {
      ...builtin,
      source: "builtin",
      path: null,
      content: builtin.content
    });
  }
  const userSkills = [];
  scanSkillDir(join4(getComicodeHome(), "skills"), "user", userSkills);
  for (const skill of userSkills) byName.set(skill.name, skill);
  const projectSkills = [];
  scanSkillDir(join4(root, ".comicode", "skills"), "project", projectSkills);
  scanSkillDir(join4(root, ".agents", "skills"), "project", projectSkills);
  for (const skill of projectSkills) byName.set(skill.name, skill);
  return [...byName.values()];
}
function findSkill(skills, name) {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  return skills.find((skill) => skill.name.toLowerCase() === needle) ?? skills.find((skill) => skill.name.toLowerCase().startsWith(needle)) ?? skills.find((skill) => skill.name.toLowerCase().includes(needle)) ?? null;
}
function formatSkillsSection(skills) {
  if (skills.length === 0) return "";
  const lines = [
    "# Skills",
    "Skills are reusable instruction packs. When a skill matches the task, call the `use_skill` tool with its name to load the full instructions, then follow them.",
    ""
  ];
  for (const skill of skills) {
    lines.push(`- ${skill.name}: ${skill.description}`);
  }
  return lines.join("\n");
}
var BUILTIN_SKILLS;
var init_skills = __esm({
  "src/core/agent/skills.ts"() {
    "use strict";
    init_paths();
    BUILTIN_SKILLS = [
      {
        name: "test-driven-change",
        description: "Write a failing test first, implement the smallest fix, then verify it passes.",
        content: `# Test-driven change

1. Find the existing test setup (package scripts, test directories, frameworks) before writing anything.
2. Write or extend a test that reproduces the bug or specifies the new behavior. Run it and confirm it fails for the right reason.
3. Implement the smallest change that makes the test pass. Do not refactor unrelated code.
4. Run the focused test again, then the broader suite if it is fast enough.
5. Report exactly which tests were added or changed and their result.`
      },
      {
        name: "debug-systematically",
        description: "Diagnose bugs by reproducing, isolating the cause, fixing it, and adding a regression check.",
        content: `# Systematic debugging

1. Reproduce the failure reliably. If you cannot reproduce it, say so and gather evidence instead of guessing.
2. Read the error output and stack trace completely before forming a hypothesis.
3. Trace the code path with read_file/search_files. Check recent changes with git_diff/git_status when available.
4. Form one hypothesis at a time and verify it with a tool call or a focused experiment.
5. Fix the root cause, not the symptom. Avoid defensive patches that hide the real bug.
6. Add or update a regression test when the project has a test suite.
7. Summarize: root cause, fix applied, and how it was verified.`
      },
      {
        name: "safe-refactor",
        description: "Restructure code without changing behavior, in small verified steps.",
        content: `# Safe refactoring

1. Establish a safety net first: run the existing tests or a build so you know the starting state is green.
2. Make one mechanical change at a time (rename, extract, move). Prefer edit_file over write_file.
3. After each step, run the fastest relevant check (typecheck, focused test, lint) before continuing.
4. Never mix refactoring with behavior changes in the same edit.
5. If a step breaks something, revert that step immediately rather than layering fixes on top.
6. Finish with the full verification suite and a summary of what moved where.`
      },
      {
        name: "code-review",
        description: "Review a diff or change set for correctness, security, and maintainability before finishing.",
        content: `# Code review

Review the change as if someone else wrote it:

1. Correctness: edge cases, off-by-one errors, null/undefined handling, async mistakes.
2. Security: injection, path traversal, secret leakage, unsafe shell usage, missing validation.
3. Scope: unrelated changes, leftover debug code, commented-out blocks, dead code.
4. Consistency: does it follow the surrounding conventions, naming, and error-handling style?
5. Verification: are tests updated? Does anything claim to work without evidence?

Report findings ordered by severity with file references. Fix what is clearly wrong; flag judgment calls for the user.`
      },
      {
        name: "design-system",
        description: "Produce exceptional UI: pick one coherent visual direction, define tokens, hierarchy, and quality rules before coding.",
        content: `# Design intelligence

Never generate a generic AI dashboard. Before writing UI code, establish a design system.

## 1. Choose ONE visual direction

Pick the single direction that fits the product \u2014 never blend styles randomly:

- premium-saas: confident, minimal chrome, one strong accent, data-dense but calm
- minimalist: extreme restraint, whitespace as structure, near-monochrome
- editorial: serif display type, strong grid, generous margins, print-inspired
- luxury: dark or ivory palette, thin type, subtle texture, no bright accents
- fintech-modern: trust signals, tabular numbers, crisp borders, muted palette
- enterprise: dense, utilitarian, accessible, predictable patterns
- ecommerce: product-first imagery, clear CTAs, card grids done well
- dashboard: real data hierarchy, compact controls, no decoration
- brutalist: raw borders, monospace accents, deliberate roughness
- creative-portfolio: expressive type, asymmetric layouts, motion-aware
- mobile-app: thumb-first, native-feeling, platform conventions

State the chosen direction and why in one line before implementing.

## 2. Define tokens before components

- Color: 1 accent + neutral scale (bg/surface/text/muted/danger). No random hues, no rainbow gradients.
- Type: one display + one body face (system stack is fine). Establish the scale: display > h1 > body > caption.
- Spacing: a consistent scale (4/8/12/16/24/32/48). Every gap comes from the scale.
- Radius/shadow: one radius family, shadows only for elevation that means something.

## 3. Layout intelligence

- Establish hierarchy first: what does the eye hit first, second, third?
- Use whitespace intentionally \u2014 never empty space for its own sake.
- Responsive: define what collapses, stacks, or hides at small widths.
- Component architecture: reuse existing components; extract only when a pattern repeats 3+ times.

## 4. Quality rules \u2014 avoid

- Generic SaaS card grids, excessive gradients, random colors, inconsistent spacing
- Unnecessary rounded cards everywhere, repetitive components, poor typography
- Over-decoration, dead empty space, inconsistent button styles

## 5. Required states

Every interactive surface needs loading, empty, error, and disabled states \u2014 not just happy path.

## 6. Verification honesty

If you can build/lint, run it. Only claim visual verification if you actually captured and inspected a screenshot or rendered output \u2014 otherwise say "not visually verified".`
      }
    ];
  }
});

// src/core/agent/modes.ts
function isAgentMode(value) {
  return value in AGENT_MODES;
}
function nextAgentMode(current, direction) {
  const index = AGENT_MODE_IDS.indexOf(current);
  const next = (index + direction + AGENT_MODE_IDS.length) % AGENT_MODE_IDS.length;
  return AGENT_MODE_IDS[next];
}
function classifyAgentMode(text) {
  const lower = text.toLowerCase();
  let best = "build";
  let bestScore = 0;
  for (const { mode, words } of MODE_KEYWORDS) {
    const score = words.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = mode;
    }
  }
  return best;
}
var AGENT_MODES, AGENT_MODE_IDS, MODE_KEYWORDS, PLAN_MODE_TOOLS;
var init_modes = __esm({
  "src/core/agent/modes.ts"() {
    "use strict";
    AGENT_MODES = {
      auto: {
        id: "auto",
        label: "auto",
        description: "Classifies the task and selects the best workflow automatically (default).",
        tools: "all",
        promptAddendum: ""
      },
      build: {
        id: "build",
        label: "build",
        description: "Full coding agent: inspect, edit, run commands, and verify.",
        tools: "all",
        promptAddendum: ""
      },
      plan: {
        id: "plan",
        label: "plan",
        description: "Read-only planning: inspect the project and produce a plan without changing files.",
        tools: "read-only",
        promptAddendum: `# Agent mode: plan
You are in PLAN MODE. You must not modify the project.

- Use only read-only tools (list_files, read_file, search_files, git_status, git_diff, environment_info).
- Do not call write_file, edit_file, apply_patch, delete_file, run_command, run_tests, run_lint, run_build, or update_plan with implementation intent.
- Instead: inspect the relevant code, then call update_plan with concrete implementation steps, and finish with task_complete summarizing the plan and open questions.
- If the user asks you to implement anyway, explain that they must switch to build mode (tab or /mode build) first.`
      },
      debug: {
        id: "debug",
        label: "debug",
        description: "Diagnosis-first agent: reproduce, isolate the root cause, fix it, and prove the fix.",
        tools: "all",
        promptAddendum: `# Agent mode: debug
You are in DEBUG MODE. The user is trying to fix a defect.

- Reproduce or isolate the failure before changing anything. Read full error output and stack traces.
- Trace the code path with tools; check git_diff/git_status for recent changes when relevant.
- Prefer the smallest fix that addresses the root cause. Add a regression test when a test suite exists.
- Use the debug-systematically skill if it helps structure the investigation.
- Verify the fix actually resolves the reported symptom before calling task_complete.`
      },
      architect: {
        id: "architect",
        label: "architect",
        description: "System design and planning: analyze structure, schema, dependencies, and risks before any changes.",
        tools: "all",
        promptAddendum: `# Agent mode: architect
You are in ARCHITECT MODE. Think before touching code.

- First map the existing architecture: entry points, modules, data flow, dependencies, and conventions.
- Identify problems, risks, edge cases, and scalability/security concerns explicitly.
- Produce a concrete implementation plan via update_plan before writing code \u2014 data model, API surface, file changes, migration steps.
- Only implement after the plan is solid; keep changes consistent with existing architecture.
- Call out trade-offs and alternatives rather than silently picking one.`
      },
      security: {
        id: "security",
        label: "security",
        description: "Security audit: auth, validation, secrets, injection, and unsafe operations \u2014 read-only.",
        tools: "read-only",
        promptAddendum: `# Agent mode: security
You are in SECURITY MODE. Audit the code \u2014 do not modify files.

- Inspect authentication/authorization, input validation, secret handling, file operations, injection surfaces (SQL, command, XSS), and insecure configuration.
- Check dependencies and lockfiles for known-risk patterns where visible.
- Report findings ordered by severity with file:line evidence and concrete remediation.
- Never claim the project is "completely secure" \u2014 state coverage and limitations honestly.`
      },
      explain: {
        id: "explain",
        label: "explain",
        description: "Read-only explainer: walk through code, architecture, errors, and concepts clearly.",
        tools: "read-only",
        promptAddendum: `# Agent mode: explain
You are in EXPLAIN MODE. Teach, don't touch.

- Use only read-only tools to inspect the relevant code before answering.
- Explain at the right level: concrete file references, data flow, and why things work the way they do.
- For errors, connect the symptom to the root cause in the code.
- Never modify files; if the user wants changes, suggest switching to build mode.`
      },
      review: {
        id: "review",
        label: "review",
        description: "Read-only code review: find bugs, risks, and improvements without editing.",
        tools: "read-only",
        promptAddendum: `# Agent mode: review
You are in REVIEW MODE. Analyze the code and report findings \u2014 do not modify anything.

- Use only read-only tools. Load the code-review skill for a structured checklist.
- Report concrete findings ordered by severity: file, line, problem, suggested fix.
- Cover correctness bugs, security issues, error handling, and unnecessary complexity.
- If nothing is wrong, say so plainly \u2014 do not invent findings.
- Finish with task_complete summarizing the verdict.`
      },
      refactor: {
        id: "refactor",
        label: "refactor",
        description: "Safe incremental restructuring: simplify and modernize without behavior changes.",
        tools: "all",
        promptAddendum: `# Agent mode: refactor
You are in REFACTOR MODE. Improve structure while preserving behavior exactly.

- Load the safe-refactor skill before starting.
- Make small, verifiable steps. Run tests/build after each meaningful change.
- Never change external behavior, APIs, or output formats unless the user asked.
- Prefer deleting dead code and reducing duplication over adding abstractions.
- If a change cannot be verified, revert it and note why.`
      },
      test: {
        id: "test",
        label: "test",
        description: "Test-first agent: write failing tests, implement, and prove coverage.",
        tools: "all",
        promptAddendum: `# Agent mode: test
You are in TEST MODE. Your job is to make the requested behavior provably correct.

- Load the test-driven-change skill before writing code.
- Write or update tests first where a test suite exists; run them to see them fail, then implement.
- Cover edge cases and error paths, not just the happy path.
- Run the project's test/lint/build commands to verify; report exact results.`
      },
      docs: {
        id: "docs",
        label: "docs",
        description: "Documentation agent: write and improve README, guides, and comments.",
        tools: "all",
        promptAddendum: `# Agent mode: docs
You are in DOCS MODE. Your job is clear, accurate written documentation.

- Read the actual code before documenting it \u2014 never guess at behavior.
- Prefer updating existing docs over creating new files; match the project's doc style.
- Keep examples runnable and commands copy-pasteable.
- Do not change implementation code unless a doc fix requires a trivial correction the user asked for.`
      },
      design: {
        id: "design",
        label: "design",
        description: "UI/design agent: improve layout, styling, and interaction \u2014 including web-app conversion.",
        tools: "all",
        promptAddendum: `# Agent mode: design
You are in DESIGN MODE. Focus on visual quality, layout, and interaction.

- For web/UI work, load the design-system skill FIRST and follow its direction/token/rules process.
- Keep the existing stack and conventions; improve composition, spacing, typography, and states.
- Handle loading, empty, error, and responsive states \u2014 not just the happy path.
- Verify with build/lint; if a dev server or screenshot check is possible, use it.`
      }
    };
    AGENT_MODE_IDS = Object.keys(AGENT_MODES);
    MODE_KEYWORDS = [
      {
        mode: "security",
        words: [
          "security",
          "vulnerab",
          "exploit",
          "injection",
          "xss",
          "csrf",
          "auth",
          "secret",
          "permission",
          "sanitize",
          "encrypt"
        ]
      },
      {
        mode: "review",
        words: ["review", "audit code", "code review", "inspect code", "check code"]
      },
      {
        mode: "debug",
        words: [
          "bug",
          "error",
          "crash",
          "fail",
          "broken",
          "fix",
          "debug",
          "exception",
          "stack",
          "regression",
          "not working",
          "issue"
        ]
      },
      {
        mode: "refactor",
        words: ["refactor", "clean up", "simplify", "restructure", "dedupe", "modernize"]
      },
      {
        mode: "test",
        words: ["test", "coverage", "unit test", "e2e", "spec"]
      },
      {
        mode: "docs",
        words: ["document", "readme", "docs", "changelog", "comment", "explain in docs"]
      },
      {
        mode: "design",
        words: [
          "design",
          "ui",
          "ux",
          "css",
          "style",
          "layout",
          "page",
          "landing",
          "component",
          "convert",
          "website",
          "mockup",
          "frontend look"
        ]
      },
      {
        mode: "architect",
        words: [
          "architect",
          "system design",
          "database schema",
          "scalab",
          "structure",
          "migration plan",
          "high-level design"
        ]
      },
      {
        mode: "explain",
        words: ["explain", "what does", "how does", "walk me through", "understand"]
      }
    ];
    PLAN_MODE_TOOLS = /* @__PURE__ */ new Set([
      "list_files",
      "read_file",
      "search_files",
      "git_status",
      "git_diff",
      "environment_info",
      "use_skill",
      "update_plan",
      "task_complete"
    ]);
  }
});

// src/core/safety/files.ts
import { readdirSync as readdirSync2, readFileSync as readFileSync4, statSync as statSync4 } from "fs";
import { join as join5, relative, sep } from "path";
import ignore from "ignore";
function loadIgnoreMatcher(root) {
  const matcher = ignore().add(DEFAULT_IGNORES);
  for (const file of [".gitignore", ".comicodeignore"]) {
    try {
      const text = readFileSync4(join5(root, file), "utf8");
      matcher.add(
        text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"))
      );
    } catch {
    }
  }
  if (process.env.COMICODE_RESPECT_NESTED_GITIGNORE !== "0") {
  }
  return matcher;
}
async function gitFiles(root, limit) {
  const result = await runProcess(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, timeoutMs: 15e3, maxOutputBytes: 8e6 }
  );
  if (result.spawnError || result.code !== 0) return null;
  const names = result.stdout.split("\0").filter(Boolean);
  const entries = [];
  for (const name of names) {
    if (entries.length >= limit) break;
    const path = name.replace(/\\/g, "/");
    try {
      const stats = statSync4(join5(root, name));
      if (!stats.isFile()) continue;
      entries.push({ path, size: stats.size });
    } catch {
    }
  }
  return entries;
}
function walkFiles(root, limit) {
  const matcher = loadIgnoreMatcher(root);
  const entries = [];
  const queue = [""];
  while (queue.length && entries.length < limit) {
    const relDir = queue.shift();
    let children;
    try {
      children = readdirSync2(join5(root, relDir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      const rel = (relDir ? `${relDir}/${child.name}` : child.name).split(sep).join("/");
      if (matcher.ignores(rel + (child.isDirectory() ? "/" : ""))) continue;
      if (child.isDirectory()) {
        queue.push(rel);
      } else if (child.isFile()) {
        try {
          const stats = statSync4(join5(root, rel));
          entries.push({ path: rel, size: stats.size });
        } catch {
        }
        if (entries.length >= limit) break;
      }
    }
  }
  return entries;
}
async function listProjectFiles(root, limit = 3e3) {
  const git = await gitFiles(root, limit);
  return git ?? walkFiles(root, limit);
}
function isBinaryBuffer(buffer) {
  const sample = buffer.subarray(0, 8e3);
  return sample.includes(0);
}
function relativePath(root, absolute) {
  return relative(root, absolute).split(sep).join("/");
}
var DEFAULT_IGNORES;
var init_files = __esm({
  "src/core/safety/files.ts"() {
    "use strict";
    init_process();
    DEFAULT_IGNORES = [
      "node_modules/",
      ".git/",
      ".comicode/",
      "dist/",
      "build/",
      "coverage/",
      ".next/",
      ".nuxt/",
      ".turbo/",
      ".cache/",
      "__pycache__/",
      ".venv/",
      "venv/",
      "target/",
      "vendor/",
      "*.min.js",
      "*.map",
      "*.lock",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "*.log"
    ];
  }
});

// src/core/project/inspector.ts
import { existsSync as existsSync5, readFileSync as readFileSync5, statSync as statSync5 } from "fs";
import { basename as basename2, extname, join as join6 } from "path";
import { createHash as createHash2 } from "crypto";
function readText(path, maxBytes = 4e4) {
  try {
    if (!existsSync5(path)) return null;
    if (statSync5(path).size > maxBytes) {
      return readFileSync5(path, "utf8").slice(0, maxBytes) + "\n... [truncated]";
    }
    return readFileSync5(path, "utf8");
  } catch {
    return null;
  }
}
var LANGUAGE_MAP, SNAPSHOT_TTL_MS, ProjectInspector, STOP_WORDS;
var init_inspector = __esm({
  "src/core/project/inspector.ts"() {
    "use strict";
    init_process();
    init_files();
    init_files();
    LANGUAGE_MAP = {
      ".ts": "TypeScript",
      ".tsx": "TypeScript",
      ".js": "JavaScript",
      ".jsx": "JavaScript",
      ".mjs": "JavaScript",
      ".cjs": "JavaScript",
      ".py": "Python",
      ".rs": "Rust",
      ".go": "Go",
      ".java": "Java",
      ".kt": "Kotlin",
      ".cs": "C#",
      ".cpp": "C++",
      ".cc": "C++",
      ".c": "C",
      ".h": "C/C++ headers",
      ".rb": "Ruby",
      ".php": "PHP",
      ".swift": "Swift",
      ".dart": "Dart",
      ".vue": "Vue",
      ".svelte": "Svelte",
      ".sh": "Shell",
      ".ps1": "PowerShell",
      ".md": "Markdown",
      ".sql": "SQL"
    };
    SNAPSHOT_TTL_MS = 12e4;
    ProjectInspector = class {
      constructor(root, cache) {
        this.root = root;
        this.cache = cache;
      }
      root;
      cache;
      projectName() {
        const pkg = readText(join6(this.root, "package.json"), 1e5);
        if (pkg) {
          try {
            const parsed = JSON.parse(pkg);
            if (typeof parsed.name === "string" && parsed.name.trim()) return parsed.name.trim();
          } catch {
          }
        }
        return basename2(this.root);
      }
      async gitInfo() {
        const status = await runProcess("git", ["status", "--porcelain=v1", "-b"], {
          cwd: this.root,
          timeoutMs: 1e4,
          maxOutputBytes: 1e5
        });
        if (status.spawnError || status.code !== 0) {
          return { isRepo: false, branch: null, status: null, lastCommit: null };
        }
        const lines = status.stdout.split(/\r?\n/).filter(Boolean);
        const branchLine = lines[0]?.startsWith("##") ? lines[0].slice(2) : null;
        const branch = branchLine ? branchLine.split("...")[0]?.trim() ?? null : null;
        const changed = lines.filter((line) => !line.startsWith("##")).slice(0, 80).join("\n");
        const log = await runProcess("git", ["log", "-1", "--pretty=%h %s"], {
          cwd: this.root,
          timeoutMs: 8e3,
          maxOutputBytes: 5e3
        });
        return {
          isRepo: true,
          branch,
          status: changed || null,
          lastCommit: log.code === 0 ? log.stdout.trim() || null : null
        };
      }
      async snapshot() {
        if (this.cache) {
          try {
            const cached = await this.cache.get(this.root);
            if (cached && Date.now() - Date.parse(cached.updatedAt) < SNAPSHOT_TTL_MS) {
              return cached.snapshot;
            }
          } catch {
          }
        }
        const snapshot = await this.scanSnapshot();
        if (this.cache) {
          try {
            await this.cache.set(this.root, snapshot);
          } catch {
          }
        }
        return snapshot;
      }
      async scanSnapshot() {
        const files = await listProjectFiles(this.root, 4e3);
        const languages = /* @__PURE__ */ new Map();
        const topLevel = /* @__PURE__ */ new Map();
        for (const file of files) {
          const language = LANGUAGE_MAP[extname(file.path).toLowerCase()];
          if (language) languages.set(language, (languages.get(language) ?? 0) + 1);
          const [head] = file.path.split("/");
          if (!head) continue;
          const isDir = file.path.includes("/");
          const entry = topLevel.get(head) ?? { type: isDir ? "directory" : "file", files: 0 };
          entry.files += 1;
          entry.type = isDir ? "directory" : entry.type;
          topLevel.set(head, entry);
        }
        const keyFileCandidates = [
          "package.json",
          "pyproject.toml",
          "Cargo.toml",
          "go.mod",
          "README.md",
          "README",
          "tsconfig.json",
          "Makefile",
          "requirements.txt",
          "composer.json",
          "Gemfile",
          ".comicode/project.json"
        ];
        const keyFiles = [];
        for (const candidate of keyFileCandidates) {
          const text = readText(join6(this.root, candidate), 12e3);
          if (text) {
            keyFiles.push({ path: candidate, excerpt: text.slice(0, 6e3) });
            if (keyFiles.length >= 5) break;
          }
        }
        const git = await this.gitInfo();
        const languageList = [...languages.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, files: count }));
        const topLevelList = [...topLevel.entries()].sort((a, b) => b[1].files - a[1].files).slice(0, 24).map(([name, entry]) => ({ name, type: entry.type, files: entry.files }));
        const summaryText = this.formatSummary({
          name: this.projectName(),
          root: this.root,
          files: files.length,
          topLevel: topLevelList,
          languages: languageList,
          keyFiles,
          git,
          summaryText: ""
        });
        return {
          name: this.projectName(),
          root: this.root,
          files: files.length,
          topLevel: topLevelList,
          languages: languageList,
          keyFiles,
          git,
          summaryText
        };
      }
      formatSummary(snapshot) {
        const lines = [
          `Project: ${snapshot.name}`,
          `Root: ${snapshot.root}`,
          `Files (ignored files excluded): ${snapshot.files}`,
          `Languages: ${snapshot.languages.map((entry) => `${entry.name} (${entry.files})`).join(", ") || "unknown"}`,
          `Top level: ${snapshot.topLevel.map((entry) => `${entry.name}${entry.type === "directory" ? "/" : ""} [${entry.files}]`).join(", ")}`,
          `Git: ${snapshot.git.isRepo ? `${snapshot.git.branch ?? "detached"}${snapshot.git.lastCommit ? `, last commit ${snapshot.git.lastCommit}` : ""}` : "not a git repository"}`
        ];
        if (snapshot.git.status) {
          lines.push(
            `Working tree changes:
${snapshot.git.status.split("\n").slice(0, 30).join("\n")}`
          );
        }
        for (const file of snapshot.keyFiles) {
          lines.push(`
--- ${file.path} ---
${file.excerpt}`);
        }
        return lines.join("\n");
      }
      async relevantFiles(request, options = {}) {
        const limit = options.limit ?? 18;
        const files = await listProjectFiles(this.root, 4e3);
        const tokens = request.toLowerCase().split(/[^a-z0-9_./-]+/).filter((token) => token.length >= 3 && !STOP_WORDS.has(token)).slice(0, 40);
        const scored = [];
        const changed = new Set((options.changedFiles ?? []).map((path) => path.replace(/\\/g, "/")));
        const extra = new Set((options.extraFiles ?? []).map((path) => path.replace(/\\/g, "/")));
        for (const file of files) {
          const lower = file.path.toLowerCase();
          let score = 0;
          const reasons = [];
          if (changed.has(file.path)) {
            score += 100;
            reasons.push("changed in this task");
          }
          if (extra.has(file.path)) {
            score += 80;
            reasons.push("previously relevant");
          }
          for (const token of tokens) {
            if (lower.includes(token)) {
              score += token.length >= 6 ? 8 : 4;
              reasons.push(`matches "${token}"`);
            } else {
              const base = lower.split("/").pop() ?? "";
              if (base.includes(token)) score += 6;
            }
          }
          if (/^(package\.json|tsconfig\.json|pyproject\.toml|Cargo\.toml|go\.mod|README\.md)$/i.test(
            file.path
          )) {
            score += 12;
            reasons.push("project manifest");
          }
          if (/(^|\/)(src|lib|app)\//.test(file.path)) score += 2;
          if (score > 0) {
            scored.push({
              path: file.path,
              score,
              reason: reasons.slice(0, 3).join("; ") || "relevant"
            });
          }
        }
        scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
        const selected = scored.slice(0, limit).map(({ path, reason }) => ({ path, reason }));
        if (selected.length < 6) {
          for (const file of files) {
            if (selected.length >= 6) break;
            if (selected.some((entry) => entry.path === file.path)) continue;
            if (/\.(ts|tsx|js|jsx|py|rs|go|java|rb|php|cs|cpp|c|vue|svelte)$/i.test(file.path)) {
              selected.push({ path: file.path, reason: "source file fallback" });
            }
          }
        }
        return selected;
      }
      async resumeState(changedFiles) {
        const git = await this.gitInfo();
        const lines = [];
        lines.push(`Git: ${git.isRepo ? git.branch ?? "detached" : "not a repository"}`);
        if (git.status) lines.push(`Working tree:
${git.status}`);
        const hashes = [];
        for (const path of changedFiles.slice(0, 20)) {
          try {
            const absolute = join6(this.root, path);
            const content = readFileSync5(absolute);
            hashes.push(`${path}: ${createHash2("sha256").update(content).digest("hex").slice(0, 12)}`);
          } catch {
            hashes.push(`${path}: <missing>`);
          }
        }
        if (hashes.length) lines.push(`Changed file fingerprints:
${hashes.join("\n")}`);
        return lines.join("\n");
      }
      detectCommands() {
        const pkgText = readText(join6(this.root, "package.json"), 2e5);
        const packageManager = existsSync5(join6(this.root, "pnpm-lock.yaml")) ? "pnpm" : existsSync5(join6(this.root, "yarn.lock")) ? "yarn" : existsSync5(join6(this.root, "bun.lockb")) || existsSync5(join6(this.root, "bun.lock")) ? "bun" : "npm";
        const run = (script) => {
          if (packageManager === "yarn") return `yarn ${script}`;
          if (packageManager === "pnpm") return `pnpm ${script}`;
          if (packageManager === "bun") return `bun run ${script}`;
          return `npm run ${script}`;
        };
        if (pkgText) {
          try {
            const pkg = JSON.parse(pkgText);
            const scripts = pkg.scripts ?? {};
            const pick = (...names) => names.find((name) => scripts[name]);
            const test = pick("test", "test:unit", "vitest");
            const lint = pick("lint", "typecheck", "check");
            const build = pick("build", "compile");
            const dev = pick("dev", "start");
            return {
              packageManager,
              test: test ? run(test) : packageManager === "npm" ? "npm test" : run("test"),
              lint: lint ? run(lint) : null,
              build: build ? run(build) : null,
              dev: dev ? run(dev) : null
            };
          } catch {
          }
        }
        if (existsSync5(join6(this.root, "Cargo.toml"))) {
          return {
            packageManager: null,
            test: "cargo test",
            lint: "cargo clippy",
            build: "cargo build",
            dev: "cargo run"
          };
        }
        if (existsSync5(join6(this.root, "go.mod"))) {
          return {
            packageManager: null,
            test: "go test ./...",
            lint: "go vet ./...",
            build: "go build ./...",
            dev: null
          };
        }
        if (existsSync5(join6(this.root, "pyproject.toml")) || existsSync5(join6(this.root, "requirements.txt"))) {
          return {
            packageManager: null,
            test: "pytest",
            lint: existsSync5(join6(this.root, "pyproject.toml")) ? "python -m ruff check ." : null,
            build: null,
            dev: null
          };
        }
        return { packageManager: null, test: null, lint: null, build: null, dev: null };
      }
      fileHash(relative4) {
        try {
          return createHash2("sha256").update(readFileSync5(join6(this.root, relative4))).digest("hex");
        } catch {
          return null;
        }
      }
      relative(absolute) {
        return relativePath(this.root, absolute);
      }
    };
    STOP_WORDS = /* @__PURE__ */ new Set([
      "the",
      "and",
      "for",
      "with",
      "this",
      "that",
      "from",
      "have",
      "into",
      "your",
      "please",
      "make",
      "can",
      "you",
      "should",
      "would",
      "could",
      "fix",
      "add",
      "update",
      "change",
      "create",
      "build",
      "implement",
      "refactor",
      "task",
      "code",
      "file",
      "files",
      "project"
    ]);
  }
});

// src/core/routing/capabilities.ts
function clamp(value) {
  return Math.max(0, Math.min(10, value));
}
function metadataNumber(model, key) {
  const raw = model.metadata?.capabilities;
  if (raw && typeof raw === "object") {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}
function modelCapabilities(model) {
  const meta = (key) => metadataNumber(model, key);
  const contextScore = model.contextWindow ? clamp(Math.log10(model.contextWindow) * 2.2 - 5) : 4;
  const inPrice = model.inputPricePerMillion;
  const outPrice = model.outputPricePerMillion;
  const costScore = inPrice === null && outPrice === null ? 4 : clamp(
    Math.log10(Math.max(0.01, (inPrice ?? 0) + (outPrice ?? 0) * 3)) * 3 + 2
  );
  return {
    reasoning: meta("reasoning") ?? clamp(model.reasoningSuitability * 2),
    coding: meta("coding") ?? clamp(model.codingSuitability * 2),
    instruction: meta("instruction") ?? clamp(model.codingSuitability),
    tools: meta("tools") ?? (model.supportsTools ? 8 : 0),
    structured: meta("structured") ?? (model.supportsTools ? 7 : 3),
    speed: meta("speed") ?? 5,
    // providers rarely report latency; neutral default
    vision: meta("vision") ?? (model.supportsVision ? 9 : 0),
    context: meta("context") ?? contextScore,
    cost: meta("cost") ?? costScore
  };
}
function capabilityWeights(taskType) {
  switch (taskType) {
    case "coding":
      return { coding: 3, tools: 2.5, instruction: 2, reasoning: 1.5, context: 1, structured: 1 };
    case "reasoning":
    case "review":
      return { reasoning: 3, instruction: 2, coding: 1.5, context: 1.5, structured: 1 };
    case "vision":
      return { vision: 4, coding: 1.5, tools: 1.5, context: 1 };
    case "general":
    default:
      return { instruction: 2.5, reasoning: 2, coding: 1.5, speed: 1, cost: 0.5 };
  }
}
function capabilityScore(model, taskType) {
  const caps = modelCapabilities(model);
  const weights = capabilityWeights(taskType);
  let score = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(weights)) {
    score += caps[key] * weight;
    totalWeight += weight;
  }
  score -= caps.cost * 0.4;
  return totalWeight > 0 ? score / totalWeight : score;
}
var init_capabilities = __esm({
  "src/core/routing/capabilities.ts"() {
    "use strict";
  }
});

// src/core/routing/engine.ts
function candidateKey(profileId, modelId) {
  return `${profileId}::${modelId}`;
}
function requirementsForTask(taskType) {
  return {
    tools: true,
    vision: taskType === "vision",
    streaming: false
  };
}
function isLimitActiveNow(limit, nowMs) {
  return limit.active && nowMs >= 0;
}
function profilePriority(profile) {
  const raw = profile.config?.priority;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 100;
}
function modelScore(model, taskType, preferCoding) {
  let score = 0;
  if (preferCoding) score += model.codingSuitability * 12;
  if (taskType === "reasoning" || taskType === "review") score += model.reasoningSuitability * 10;
  if (taskType === "coding") score += model.codingSuitability * 4;
  if (model.contextWindow) score += Math.min(20, Math.log10(model.contextWindow) * 2);
  if (model.maxOutputTokens) score += Math.min(10, Math.log10(model.maxOutputTokens));
  score += capabilityScore(model, taskType) * 8;
  return score;
}
function accessBucket(access, preferFree) {
  if (!preferFree) return 0;
  if (access === "free-confirmed" || access === "user-free") return 3;
  if (access === "free-tier") return 2;
  if (access === "unknown") return 1;
  return 0;
}
function syntheticModel(profile, modelId) {
  return {
    id: `${profile.providerId}:${profile.id}:${modelId}:selected`,
    providerId: profile.providerId,
    profileId: profile.providerId === "custom" ? profile.id : null,
    modelId,
    displayName: modelId,
    contextWindow: null,
    maxOutputTokens: null,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    codingSuitability: 2,
    reasoningSuitability: 2,
    inputPricePerMillion: null,
    outputPricePerMillion: null,
    access: "unknown",
    accessSource: "selected-model",
    accessNotes: "Model is not in the catalog yet; capabilities are assumed until verified.",
    available: true,
    lastCheckedAt: null,
    userClassification: null,
    metadata: { synthetic: true }
  };
}
function findModel(request, profile, modelId) {
  return request.models.find(
    (model) => model.providerId === profile.providerId && model.modelId === modelId && (model.profileId === null || model.profileId === profile.id)
  ) ?? null;
}
function buildRoutingOutcome(request) {
  const nowMs = Date.now();
  const blocked = [];
  const exclude = new Set(request.excludeKeys ?? []);
  const excludedProfiles = new Set(request.excludedProfileIds ?? []);
  const requirements = {
    ...requirementsForTask(request.taskType),
    ...request.requirements
  };
  const minContext = request.policy.minContextWindow || requirements.minContextWindow || 0;
  const profileById = new Map(request.profiles.map((profile) => [profile.id, profile]));
  const limitsByProfile = /* @__PURE__ */ new Map();
  for (const limit2 of request.limits) {
    if (!limit2.active) continue;
    const list = limitsByProfile.get(limit2.profileId) ?? [];
    list.push(limit2);
    limitsByProfile.set(limit2.profileId, list);
  }
  const currentProfile = request.currentProfileId ? profileById.get(request.currentProfileId) ?? null : null;
  const currentModelId = request.currentModelId?.trim() || null;
  const eligibleProfiles = request.profiles.filter((profile) => {
    if (excludedProfiles.has(profile.id)) {
      blocked.push({
        profileId: profile.id,
        modelId: null,
        reason: "Profile excluded for this attempt."
      });
      return false;
    }
    if (!profile.enabled) {
      blocked.push({
        profileId: profile.id,
        modelId: null,
        reason: "Profile is disabled."
      });
      return false;
    }
    if (request.policy.excludedProviders.includes(profile.providerId)) {
      blocked.push({
        profileId: profile.id,
        modelId: null,
        reason: `Provider ${providerDisplayName(profile.providerId)} is excluded by routing policy.`
      });
      return false;
    }
    return true;
  });
  const meetsRequirements = (profile, model, explicit) => {
    if (model.userClassification === "unavailable") return "Model is marked unavailable.";
    if (explicit) return null;
    if (!model.available) return "Model is not verified/available in the catalog.";
    if (requirements.tools && !model.supportsTools) return "Model does not support tool calling.";
    if (requirements.vision && !model.supportsVision) return "Model does not support vision.";
    if (minContext > 0 && model.contextWindow !== null && model.contextWindow < minContext) {
      return `Context window (${model.contextWindow.toLocaleString()}) is below the policy minimum.`;
    }
    const access = effectiveAccess(model, profile.accessClassification);
    if (access === "unavailable") return "Model is marked unavailable.";
    if (isPaidAccess(access) && !request.policy.allowPaid) {
      return "Paid model blocked by policy (allowPaid is off).";
    }
    if (access === "unknown" && !request.policy.allowUnknownAccess) {
      return "Unknown pricing/access blocked by policy.";
    }
    return null;
  };
  const limitReason = (profileId, modelId) => {
    const profileLimits = limitsByProfile.get(profileId) ?? [];
    const active = profileLimits.find(
      (limit2) => isLimitActiveNow(limit2, nowMs) && (limit2.modelId === "*" || limit2.modelId === modelId)
    );
    if (!active) return null;
    const reset = active.resetAt ?? active.retryAfterAt;
    if (reset) {
      return `Temporarily unavailable (${active.category}); provider reset at ${reset}.`;
    }
    return `Temporarily unavailable (${active.category}); reset time unknown.`;
  };
  const compareModels = (profile) => (a, b) => {
    const accessDiff = accessBucket(effectiveAccess(b, profile.accessClassification), request.policy.preferFree) - accessBucket(effectiveAccess(a, profile.accessClassification), request.policy.preferFree);
    if (accessDiff !== 0) return accessDiff;
    return modelScore(b, request.taskType, request.policy.preferCoding) - modelScore(a, request.taskType, request.policy.preferCoding);
  };
  const meta = [];
  const seen = /* @__PURE__ */ new Set();
  const eligibleProfileIds = new Set(eligibleProfiles.map((profile) => profile.id));
  const addCandidate = (profile, model, options) => {
    if (!eligibleProfileIds.has(profile.id)) return;
    const key = candidateKey(profile.id, model.modelId);
    if (seen.has(key)) return;
    if (exclude.has(key)) {
      blocked.push({
        profileId: profile.id,
        modelId: model.modelId,
        reason: "This profile/model already failed in the current task."
      });
      return;
    }
    const limit2 = options.explicit ? null : limitReason(profile.id, model.modelId);
    if (limit2) {
      blocked.push({ profileId: profile.id, modelId: model.modelId, reason: limit2 });
      return;
    }
    const unmet = meetsRequirements(profile, model, options.explicit);
    if (unmet) {
      blocked.push({ profileId: profile.id, modelId: model.modelId, reason: unmet });
      return;
    }
    seen.add(key);
    const access = effectiveAccess(model, profile.accessClassification);
    meta.push({
      candidate: { profile, model },
      key,
      explicit: options.explicit,
      access,
      isDefaultModel: options.isDefaultModel,
      sameModel: options.sameModel,
      profile,
      model
    });
  };
  if (currentProfile && currentModelId) {
    if (!eligibleProfileIds.has(currentProfile.id)) {
      blocked.push({
        profileId: currentProfile.id,
        modelId: currentModelId,
        reason: "Selected profile is disabled or excluded."
      });
    } else {
      const model = findModel(request, currentProfile, currentModelId) ?? syntheticModel(currentProfile, currentModelId);
      addCandidate(currentProfile, model, {
        explicit: true,
        isDefaultModel: true,
        sameModel: true
      });
    }
  }
  const sameProviderId = currentProfile?.providerId ?? null;
  if (request.policy.preferSameProvider && sameProviderId) {
    const sameProviderProfiles = eligibleProfiles.filter((profile) => profile.providerId === sameProviderId).sort((a, b) => {
      const freeDiff = accessBucket(
        a.accessClassification === "user-free" ? "user-free" : a.accessClassification === "free-confirmed" ? "free-confirmed" : a.accessClassification === "free-tier" ? "free-tier" : "unknown",
        request.policy.preferFree
      ) - accessBucket(
        b.accessClassification === "user-free" ? "user-free" : b.accessClassification === "free-confirmed" ? "free-confirmed" : b.accessClassification === "free-tier" ? "free-tier" : "unknown",
        request.policy.preferFree
      );
      if (freeDiff !== 0) return -freeDiff;
      const priorityDiff = profilePriority(a) - profilePriority(b);
      if (priorityDiff !== 0) return priorityDiff;
      return (a.lastSuccessAt ?? "").localeCompare(b.lastSuccessAt ?? "") * -1;
    });
    for (const profile of sameProviderProfiles) {
      if (profile.id === currentProfile?.id) {
        const models2 = request.models.filter(
          (model) => model.providerId === profile.providerId && model.available && (model.profileId === null || model.profileId === profile.id) && model.modelId !== currentModelId
        ).sort(compareModels(profile));
        for (const model of models2) {
          addCandidate(profile, model, {
            explicit: false,
            isDefaultModel: model.modelId === profile.defaultModel,
            sameModel: false
          });
        }
        continue;
      }
      if (profile.defaultModel) {
        const model = findModel(request, profile, profile.defaultModel) ?? syntheticModel(profile, profile.defaultModel);
        addCandidate(profile, model, {
          explicit: false,
          isDefaultModel: true,
          sameModel: profile.defaultModel === currentModelId
        });
      }
      const models = request.models.filter(
        (model) => model.providerId === profile.providerId && model.available && (model.profileId === null || model.profileId === profile.id) && model.modelId !== profile.defaultModel
      ).sort(compareModels(profile));
      for (const model of models) {
        addCandidate(profile, model, {
          explicit: false,
          isDefaultModel: false,
          sameModel: model.modelId === currentModelId
        });
      }
    }
  }
  const otherProfiles = eligibleProfiles.filter((profile) => profile.providerId !== sameProviderId).sort((a, b) => {
    const preferred = request.policy.preferredProviders;
    const ai = preferred.indexOf(a.providerId);
    const bi = preferred.indexOf(b.providerId);
    const aRank = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const bRank = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    if (aRank !== bRank) return aRank - bRank;
    const freeDiff = accessBucket(a.accessClassification, request.policy.preferFree) - accessBucket(b.accessClassification, request.policy.preferFree);
    if (freeDiff !== 0) return -freeDiff;
    const priorityDiff = profilePriority(a) - profilePriority(b);
    if (priorityDiff !== 0) return priorityDiff;
    return providerDisplayName(a.providerId).localeCompare(providerDisplayName(b.providerId));
  });
  for (const profile of otherProfiles) {
    if (profile.defaultModel) {
      const model = findModel(request, profile, profile.defaultModel) ?? syntheticModel(profile, profile.defaultModel);
      addCandidate(profile, model, {
        explicit: false,
        isDefaultModel: true,
        sameModel: profile.defaultModel === currentModelId
      });
    }
    const models = request.models.filter(
      (model) => model.providerId === profile.providerId && model.available && (model.profileId === null || model.profileId === profile.id) && model.modelId !== profile.defaultModel
    ).sort(compareModels(profile));
    for (const model of models) {
      addCandidate(profile, model, {
        explicit: false,
        isDefaultModel: false,
        sameModel: model.modelId === currentModelId
      });
    }
  }
  const rank = (entry) => {
    let score = 0;
    if (entry.explicit) score += 1e6;
    if (request.policy.preferSameProvider && entry.profile.providerId === sameProviderId) {
      score += 1e5;
    }
    const preferredIndex = request.policy.preferredProviders.indexOf(entry.profile.providerId);
    if (preferredIndex !== -1) score += 5e4 - preferredIndex * 100;
    score += accessBucket(entry.access, request.policy.preferFree) * 5e3;
    if (entry.sameModel && entry.profile.providerId === sameProviderId) score += 2e3;
    if (entry.isDefaultModel) score += 800;
    score += modelScore(entry.model, request.taskType, request.policy.preferCoding);
    score += Math.max(0, 300 - profilePriority(entry.profile));
    score -= 0;
    return score;
  };
  const ranked = meta.map((entry) => {
    const rankValue = rank(entry);
    let reason;
    if (entry.explicit) reason = "Explicitly selected model";
    else if (entry.profile.providerId === sameProviderId) {
      reason = `Same-provider fallback: ${profileDisplay(entry.profile)}`;
    } else {
      reason = `Cross-provider fallback: ${profileDisplay(entry.profile)} (${providerDisplayName(
        entry.profile.providerId
      )})`;
    }
    return {
      ...entry.candidate,
      key: entry.key,
      explicit: entry.explicit,
      access: entry.access,
      reason,
      rank: rankValue
    };
  }).sort((a, b) => b.rank - a.rank || a.key.localeCompare(b.key));
  const limit = Math.max(1, request.policy.maxFallbacks) + (currentProfile && currentModelId ? 1 : 0);
  const chain = ranked.slice(0, limit);
  if (chain.length === 0) {
    if (request.profiles.length === 0) {
      blocked.push({
        profileId: null,
        modelId: null,
        reason: "No provider profiles are connected."
      });
    } else if (eligibleProfiles.length === 0) {
      blocked.push({
        profileId: null,
        modelId: null,
        reason: "No enabled provider profiles are available."
      });
    }
    return { decision: null, chain: [], blocked };
  }
  const first = chain[0];
  const decision = {
    candidate: { profile: first.profile, model: first.model },
    reason: first.reason,
    fallbackChain: chain.slice(1).map((entry) => ({
      profileId: entry.profile.id,
      profileName: profileDisplay(entry.profile),
      modelId: entry.model.modelId,
      reason: entry.reason
    })),
    blocked
  };
  return { decision, chain, blocked };
}
function profileDisplay(profile) {
  return `${profile.name} (${providerDisplayName(profile.providerId)})`;
}
var init_engine = __esm({
  "src/core/routing/engine.ts"() {
    "use strict";
    init_catalog();
    init_definitions();
    init_capabilities();
  }
});

// src/core/routing/router.ts
var Router;
var init_router = __esm({
  "src/core/routing/router.ts"() {
    "use strict";
    init_engine();
    Router = class {
      constructor(store, override = {}) {
        this.store = store;
        this.override = override;
      }
      store;
      override;
      get policy() {
        return { ...this.store.getSettings().routing, ...this.override };
      }
      select(input = {}) {
        const policy = this.policy;
        const profiles = this.store.listProfiles();
        const models = this.store.listModels();
        const limits2 = this.store.listLimits(true);
        const selection = this.resolveSelection(input, profiles);
        const outcome = buildRoutingOutcome({
          taskType: input.taskType ?? "coding",
          profiles,
          models,
          limits: limits2,
          policy,
          currentProfileId: selection.profileId,
          currentModelId: selection.modelId,
          excludeKeys: input.excludeKeys,
          excludedProfileIds: input.excludedProfileIds,
          requirements: input.requirements
        });
        return { outcome, decision: outcome.decision, selection, policy };
      }
      resolveSelection(input, profiles) {
        let profileId = input.profileId ?? this.store.getSelectedProfileId();
        let modelId = input.modelId ?? null;
        if (!modelId) {
          const savedModelDbId = this.store.getSelectedModelId();
          if (savedModelDbId) {
            const saved = this.store.getModelById(savedModelDbId);
            if (saved) {
              modelId = saved.modelId;
              if (saved.profileId) {
                const scopedProfile = profiles.find((profile2) => profile2.id === saved.profileId);
                if (scopedProfile) profileId = scopedProfile.id;
              }
            } else if (savedModelDbId.includes(":")) {
              modelId = savedModelDbId.split(":").pop() ?? null;
            }
          }
        }
        let profile = profiles.find((candidate) => candidate.id === profileId) ?? null;
        if (!profile) {
          profile = profiles.find((candidate) => candidate.enabled) ?? null;
          profileId = profile?.id ?? null;
        }
        if (!modelId) modelId = profile?.defaultModel ?? null;
        return { profileId, modelId };
      }
      /** Record a routing transition for the UI/history. */
      record(decision, input = {}) {
        if (!decision) return;
        this.store.recordRoutingEvent({
          taskId: input.taskId ?? null,
          fromProfileId: input.previousProfileId ?? null,
          fromModelId: input.previousModelId ?? null,
          toProfileId: decision.candidate.profile.id,
          toModelId: decision.candidate.model.modelId,
          reason: decision.reason,
          category: input.category ?? null
        });
      }
      /** Mark a failed candidate so the next selection avoids it. */
      static key(profileId, modelId) {
        return candidateKey(profileId, modelId);
      }
      /** Resolve a model shown in the catalog to its provider/profile. */
      resolveModel(modelDbId) {
        const model = this.store.getModelById(modelDbId);
        if (!model) return null;
        return { model, profileId: model.profileId };
      }
    };
  }
});

// src/core/safety/secrets.ts
import { basename as basename3, extname as extname2 } from "path";
function isSecretFile(relativePath2) {
  const normalized = relativePath2.replace(/\\/g, "/").replace(/^\.\//, "");
  const name = basename3(normalized);
  const lower = name.toLowerCase();
  if (EXACT.has(name) || EXACT.has(lower)) return true;
  if (lower.startsWith(".env.") || lower === ".env") return true;
  if (SECRET_EXTENSIONS.has(extname2(lower))) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(lower)) return !lower.endsWith(".pub");
  if (/^(credentials|secrets)[.-]/.test(lower)) return true;
  if (/\.(pem|key|pfx|p12)$/.test(lower)) return true;
  if (/(^|\/)\.(ssh|aws|gnupg|azure)\//.test(normalized)) return true;
  if (SENSITIVE_DIRECTORIES.some((segment) => normalized.includes(segment))) {
    return !normalized.endsWith(".pub");
  }
  if (/(^|\/)\.docker\/config\.json$/.test(normalized)) return true;
  if (/(^|\/)\.kube\/config$/.test(normalized)) return true;
  if (/\.(sqlite|db)$/.test(lower) && /comicode|credential|secret/i.test(lower)) return true;
  return false;
}
function looksLikePrivateKey(text) {
  return /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/.test(text);
}
var EXACT, SECRET_EXTENSIONS, SENSITIVE_DIRECTORIES;
var init_secrets = __esm({
  "src/core/safety/secrets.ts"() {
    "use strict";
    EXACT = /* @__PURE__ */ new Set([
      ".env",
      ".env.local",
      ".env.development",
      ".env.development.local",
      ".env.production",
      ".env.production.local",
      ".env.test",
      ".npmrc",
      ".pypirc",
      ".netrc",
      ".git-credentials",
      ".htpasswd",
      "id_rsa",
      "id_dsa",
      "id_ecdsa",
      "id_ed25519",
      "credentials",
      "credentials.json",
      "secrets.json",
      "secrets.yaml",
      "secrets.yml",
      "comicode.db"
    ]);
    SECRET_EXTENSIONS = /* @__PURE__ */ new Set([
      ".pem",
      ".key",
      ".pfx",
      ".p12",
      ".jks",
      ".keystore",
      ".kdbx",
      ".asc",
      ".gpg"
    ]);
    SENSITIVE_DIRECTORIES = [
      ".ssh/",
      ".aws/",
      ".azure/",
      ".gnupg/",
      ".docker/config.json",
      ".kube/config",
      "secrets/",
      ".secrets/"
    ];
  }
});

// src/core/safety/paths.ts
import { realpathSync, statSync as statSync6 } from "fs";
import { relative as relative2, resolve as resolve2, sep as sep2 } from "path";
function canonical(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve2(path);
  }
}
function normalizedForCompare(path) {
  const normalized = canonical(path).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function isInside(root, candidate) {
  const rootNorm = normalizedForCompare(root);
  const candidateNorm = normalizedForCompare(candidate);
  return candidateNorm === rootNorm || candidateNorm.startsWith(rootNorm + sep2);
}
var PathSafetyError, PathGuard;
var init_paths2 = __esm({
  "src/core/safety/paths.ts"() {
    "use strict";
    init_secrets();
    PathSafetyError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "PathSafetyError";
      }
    };
    PathGuard = class {
      root;
      constructor(root) {
        this.root = canonical(resolve2(root));
      }
      resolvePath(input, options = {}) {
        const trimmed = input?.trim();
        if (!trimmed) throw new PathSafetyError("A file path is required.");
        if (trimmed.includes("\0")) throw new PathSafetyError("Invalid path.");
        const absolute = resolve2(this.root, trimmed);
        if (!isInside(this.root, absolute)) {
          throw new PathSafetyError(`Path escapes the project directory: ${trimmed}`);
        }
        if (options.mustExist) {
          let stats;
          try {
            stats = statSync6(absolute);
          } catch {
            throw new PathSafetyError(`File not found: ${trimmed}`);
          }
          if (!stats.isFile() && !stats.isDirectory()) {
            throw new PathSafetyError(`Unsupported file type: ${trimmed}`);
          }
        }
        const real = canonical(absolute);
        if (!isInside(this.root, real)) {
          throw new PathSafetyError(`Symlink target escapes the project directory: ${trimmed}`);
        }
        let ancestor = absolute;
        for (let depth = 0; depth < 20; depth += 1) {
          try {
            const stats = statSync6(ancestor);
            if (stats.isDirectory()) {
              const realAncestor = canonical(ancestor);
              if (!isInside(this.root, realAncestor)) {
                throw new PathSafetyError(`Path ancestor escapes the project directory: ${trimmed}`);
              }
            }
            break;
          } catch (error) {
            if (error instanceof PathSafetyError) throw error;
            const parent = resolve2(ancestor, "..");
            if (parent === ancestor) break;
            ancestor = parent;
          }
        }
        return absolute;
      }
      relative(input) {
        const rel = relative2(this.root, this.resolvePath(input));
        return rel.split(sep2).join("/") || ".";
      }
      assertNotSecret(input, allowSecrets) {
        const absolute = this.resolvePath(input);
        const rel = this.relative(absolute);
        if (!allowSecrets && isSecretFile(rel)) {
          throw new PathSafetyError(
            `Refusing to access protected secret file "${rel}". Enable secret access explicitly if this is intentional.`
          );
        }
        return absolute;
      }
      assertWritable(input) {
        const absolute = this.resolvePath(input);
        const rel = this.relative(absolute);
        if (rel === ".git" || rel.startsWith(".git/") || rel === ".comicode" || rel.startsWith(".comicode/")) {
          throw new PathSafetyError(`Refusing to modify internal path "${rel}".`);
        }
        if (isSecretFile(rel)) {
          throw new PathSafetyError(
            `Refusing to modify protected secret file "${rel}". Edit credentials manually if required.`
          );
        }
        return absolute;
      }
    };
  }
});

// src/core/safety/diff.ts
function splitDiffLines(text) {
  if (text === "") return [""];
  const lines = text.split(/\r?\n/);
  if (text.endsWith("\n")) lines.pop();
  return lines;
}
function createUnifiedDiff(filePath, before, after, contextLines = 3) {
  if (before === after) return "";
  const a = splitDiffLines(before);
  const b = splitDiffLines(after);
  if (a.length * b.length > 4e6) {
    return [
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      `@@ large file changed: ${a.length} -> ${b.length} lines @@`,
      `${countDelta(before, after)}`
    ].join("\n");
  }
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i2 = n - 1; i2 >= 0; i2 -= 1) {
    for (let j2 = m - 1; j2 >= 0; j2 -= 1) {
      table[i2][j2] = a[i2] === b[j2] ? (table[i2 + 1][j2 + 1] ?? 0) + 1 : Math.max(table[i2 + 1][j2] ?? 0, table[i2][j2 + 1] ?? 0);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: " ", text: a[i] ?? "", aLine: i + 1, bLine: j + 1 });
      i += 1;
      j += 1;
    } else if ((table[i + 1][j] ?? 0) >= (table[i][j + 1] ?? 0)) {
      ops.push({ type: "-", text: a[i] ?? "", aLine: i + 1, bLine: j + 1 });
      i += 1;
    } else {
      ops.push({ type: "+", text: b[j] ?? "", aLine: i + 1, bLine: j + 1 });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: "-", text: a[i] ?? "", aLine: i + 1, bLine: j + 1 });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: "+", text: b[j] ?? "", aLine: i + 1, bLine: j + 1 });
    j += 1;
  }
  const changedIndexes = ops.map((op, index) => op.type !== " " ? index : -1).filter((index) => index >= 0);
  if (changedIndexes.length === 0) return "";
  const ranges = [];
  for (const index of changedIndexes) {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(ops.length - 1, index + contextLines);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }
  const lines = [`--- a/${filePath}`, `+++ b/${filePath}`];
  for (const range of ranges) {
    const slice = ops.slice(range.start, range.end + 1);
    const first = slice[0];
    const aStart = first.type === "+" ? first.aLine - 1 : first.aLine;
    const bStart = first.type === "-" ? first.bLine - 1 : first.bLine;
    const aCount = slice.filter((op) => op.type !== "+").length;
    const bCount = slice.filter((op) => op.type !== "-").length;
    lines.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const op of slice) {
      lines.push(`${op.type}${op.text}`);
    }
  }
  return lines.join("\n");
}
function countDelta(before, after) {
  const beforeLines = before ? before.split(/\r?\n/).length : 0;
  const afterLines = after ? after.split(/\r?\n/).length : 0;
  return `lines: ${beforeLines} -> ${afterLines}`;
}
function parseHunks(patch) {
  const lines = patch.split(/\r?\n/);
  const hunks = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("diff ")) continue;
    const header = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(line);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        oldCount: header[2] === void 0 ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newCount: header[4] === void 0 ? 1 : Number(header[4]),
        lines: []
      };
      hunks.push(current);
      continue;
    }
    if (current && /^[ +\-\\]/.test(line)) {
      current.lines.push(line);
    }
  }
  return hunks;
}
function applyUnifiedPatch(before, patch) {
  const hunks = parseHunks(patch);
  if (hunks.length === 0) {
    throw new Error("No unified diff hunks found. Use ---/+++ and @@ headers, or use edit_file.");
  }
  const trailingNewline = before.endsWith("\n");
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  const source = before.split(/\r?\n/);
  if (trailingNewline) source.pop();
  const output = [];
  let cursor = 0;
  for (const hunk of hunks) {
    const target = Math.max(0, hunk.oldStart - 1);
    if (target < cursor) {
      throw new Error("Patch hunks overlap or are out of order.");
    }
    while (cursor < target && cursor < source.length) {
      output.push(source[cursor]);
      cursor += 1;
    }
    for (const line of hunk.lines) {
      const marker = line[0];
      const text = line.slice(1);
      if (marker === " ") {
        if (source[cursor] !== text) {
          throw new Error(
            `Patch context mismatch at line ${cursor + 1}: expected "${text}", found "${source[cursor] ?? "<EOF>"}".`
          );
        }
        output.push(text);
        cursor += 1;
      } else if (marker === "-") {
        if (source[cursor] !== text) {
          throw new Error(
            `Patch removal mismatch at line ${cursor + 1}: expected "${text}", found "${source[cursor] ?? "<EOF>"}".`
          );
        }
        cursor += 1;
      } else if (marker === "+") {
        output.push(text);
      } else if (marker === "\\") {
        continue;
      }
    }
  }
  while (cursor < source.length) {
    output.push(source[cursor]);
    cursor += 1;
  }
  return output.join(eol) + (trailingNewline ? eol : "");
}
var init_diff = __esm({
  "src/core/safety/diff.ts"() {
    "use strict";
  }
});

// src/core/safety/shell.ts
import { spawn as spawn2 } from "child_process";
function inspectCommand(command) {
  const reasons = [];
  let blocked = false;
  for (const entry of CRITICAL_PATTERNS) {
    if (entry.pattern.test(command)) {
      reasons.push(entry.reason);
      blocked = true;
    }
  }
  for (const entry of HIGH_RISK_PATTERNS) {
    if (entry.pattern.test(command)) reasons.push(entry.reason);
  }
  return { dangerous: reasons.length > 0, reasons, blocked };
}
function sanitizedEnvironment(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (SECRET_ENV_PATTERN.test(key)) continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (SECRET_ENV_PATTERN.test(key)) continue;
    env[key] = value;
  }
  return env;
}
function truncate2(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: false };
  const keepStart = Math.floor(maxBytes * 0.6);
  const keepEnd = Math.floor(maxBytes * 0.35);
  return {
    text: text.slice(0, keepStart) + `
... [output truncated: ${text.length} characters total] ...
` + text.slice(-keepEnd),
    truncated: true
  };
}
function runShell(command, options) {
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 12e4, 1e3), 6e5);
  const maxOutputBytes = Math.min(Math.max(options.maxOutputBytes ?? 6e4, 2e3), 5e5);
  const started = Date.now();
  return new Promise((resolve6) => {
    let stdout3 = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const isWindows = process.platform === "win32";
    const shellCommand = isWindows ? process.env.ComSpec || "cmd.exe" : "/bin/sh";
    const shellArgs = isWindows ? ["/d", "/s", "/c", command] : ["-c", command];
    const child = spawn2(shellCommand, shellArgs, {
      cwd: options.cwd,
      env: sanitizedEnvironment(options.env),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const out = truncate2(stdout3, maxOutputBytes);
      const err = truncate2(stderr, Math.floor(maxOutputBytes * 0.5));
      resolve6({
        command,
        code,
        stdout: out.text,
        stderr: err.text,
        timedOut,
        durationMs: Date.now() - started,
        truncated: out.truncated || err.truncated
      });
    };
    const killTree = () => {
      timedOut = true;
      if (isWindows && child.pid) {
        spawn2("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore"
        });
      }
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 2e3).unref();
    };
    const timer = setTimeout(killTree, timeoutMs);
    const abort = () => killTree();
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", (chunk) => {
      if (stdout3.length < maxOutputBytes * 2) stdout3 += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < maxOutputBytes) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      stderr += `
${error.message}`;
      finish(null);
    });
    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", abort);
      finish(code);
    });
  });
}
function summarizeShellResult(result) {
  const parts = [];
  parts.push(`Exit code: ${result.code === null ? "unknown" : result.code}`);
  parts.push(`Duration: ${(result.durationMs / 1e3).toFixed(1)}s`);
  if (result.timedOut) parts.push("Timed out: yes");
  if (result.truncated) parts.push("Output truncated: yes");
  if (result.stdout.trim()) parts.push(`stdout:
${result.stdout.trim()}`);
  if (result.stderr.trim()) parts.push(`stderr:
${result.stderr.trim()}`);
  return parts.join("\n");
}
var CRITICAL_PATTERNS, HIGH_RISK_PATTERNS, SECRET_ENV_PATTERN;
var init_shell = __esm({
  "src/core/safety/shell.ts"() {
    "use strict";
    CRITICAL_PATTERNS = [
      {
        pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?[a-zA-Z]*\s+(\/|~|\$HOME|\.\.?)(\s|$)/i,
        reason: "Recursive deletion of /, home, or the current directory"
      },
      {
        pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r?[a-zA-Z]*\s+(\/|~|\$HOME)(\s|$)/i,
        reason: "Forced recursive deletion of / or home"
      },
      { pattern: /\b(del|erase)\s+.*\/[fsq]/i, reason: "Windows forced recursive deletion" },
      { pattern: /\bformat\s+[a-z]:/i, reason: "Disk format command" },
      { pattern: /\bmkfs(\.[a-z0-9]+)?\b/i, reason: "Filesystem creation command" },
      { pattern: /\bdd\s+.*of=\/dev\//i, reason: "Raw disk write" },
      { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: "Fork bomb" },
      { pattern: /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/i, reason: "System power command" },
      { pattern: /\bchmod\s+-R\s+777\s+\//i, reason: "World-writable permissions on root" },
      {
        pattern: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba)?sh\b/i,
        reason: "Piping a remote script directly into a shell"
      },
      { pattern: /\bInvoke-Expression\b|\biex\s*\(/i, reason: "PowerShell dynamic code execution" },
      {
        pattern: /powershell(\.exe)?\s+.*-e(nc|ncodedcommand)\b/i,
        reason: "Encoded PowerShell command"
      },
      { pattern: /\bcipher\s+\/w\b/i, reason: "Disk wiping command" },
      {
        pattern: /\bgit\s+clean\s+-[a-z]*x[a-z]*f|\bgit\s+clean\s+-[a-z]*f[a-z]*x/i,
        reason: "Deleting all untracked files including ignored files"
      }
    ];
    HIGH_RISK_PATTERNS = [
      {
        pattern: /\bsudo\b|\brunas\b|\bStart-Process\b.*-Verb\s+RunAs/i,
        reason: "Privilege escalation"
      },
      { pattern: /\bgit\s+push\b.*--force|\bgit\s+push\b.*-f\b/i, reason: "Force-pushing git history" },
      { pattern: /\bgit\s+reset\s+--hard\b/i, reason: "Discarding uncommitted work" },
      { pattern: /\bgit\s+checkout\s+--\s+\./i, reason: "Discarding working tree changes" },
      {
        pattern: /\bnpm\s+publish\b|\byarn\s+publish\b|\bpnpm\s+publish\b/i,
        reason: "Publishing a package"
      },
      { pattern: /\bdocker\s+(system\s+prune|volume\s+prune)\b/i, reason: "Deleting Docker data" },
      { pattern: /\bkubectl\s+delete\b|\bhelm\s+uninstall\b/i, reason: "Deleting cluster resources" },
      { pattern: /\bterraform\s+(destroy|apply)\b/i, reason: "Infrastructure mutation" },
      {
        pattern: /\bprisma\s+migrate\s+reset\b|\bdrop\s+database\b|\btruncate\s+table\b/i,
        reason: "Destructive database operation"
      },
      { pattern: />\s*(\/|~|[a-zA-Z]:[\\/])/, reason: "Redirecting output to an absolute path" }
    ];
    SECRET_ENV_PATTERN = /^(COMICODE_|.*_API_KEY$|.*_TOKEN$|.*_SECRET$|.*_PASSWORD$|.*_CREDENTIALS$|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|GROQ_API_KEY|OPENROUTER_API_KEY|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN)$/i;
  }
});

// src/core/agent/tools/definitions.ts
var TOOL_DEFINITIONS, TOOL_NAMES;
var init_definitions2 = __esm({
  "src/core/agent/tools/definitions.ts"() {
    "use strict";
    TOOL_DEFINITIONS = [
      {
        name: "list_files",
        description: "List files in the project, honoring .gitignore. Use this to understand structure without reading every file.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Optional subdirectory relative to the project root."
            },
            limit: { type: "integer", description: "Maximum files to return (default 200, max 1000)." }
          },
          required: []
        }
      },
      {
        name: "read_file",
        description: "Read a text file. Supports line ranges for large files. Secret files are protected and require explicit approval.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path relative to the project root." },
            start_line: { type: "integer", description: "1-based first line (optional)." },
            end_line: { type: "integer", description: "1-based last line inclusive (optional)." }
          },
          required: ["path"]
        }
      },
      {
        name: "search_files",
        description: "Search project text files with a JavaScript regular expression. Returns matching paths and line numbers.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Regular expression to search for." },
            path: { type: "string", description: "Optional subdirectory to search." },
            case_sensitive: { type: "boolean", description: "Case-sensitive search (default false)." },
            max_results: { type: "integer", description: "Maximum matches (default 60, max 200)." }
          },
          required: ["pattern"]
        }
      },
      {
        name: "write_file",
        description: "Create or replace a file with complete content. Prefer edit_file for existing files. Shows a diff and asks for approval.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path relative to the project root." },
            content: { type: "string", description: "Complete new file content." }
          },
          required: ["path", "content"]
        }
      },
      {
        name: "edit_file",
        description: "Replace an exact text block in a file. old_text must match exactly; use replace_all for repeated occurrences. Shows a diff and asks for approval.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path relative to the project root." },
            old_text: { type: "string", description: "Exact text to replace." },
            new_text: { type: "string", description: "Replacement text." },
            replace_all: { type: "boolean", description: "Replace every occurrence (default false)." }
          },
          required: ["path", "old_text", "new_text"]
        }
      },
      {
        name: "apply_patch",
        description: "Apply a unified diff to a file. The patch must include ---/+++ and @@ hunk headers. Fails safely without partial writes.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path relative to the project root." },
            patch: { type: "string", description: "Unified diff patch text." }
          },
          required: ["path", "patch"]
        }
      },
      {
        name: "delete_file",
        description: "Delete a file. Requires explicit confirmation and never deletes directories.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path relative to the project root." },
            reason: { type: "string", description: "Why deletion is necessary." }
          },
          required: ["path", "reason"]
        }
      },
      {
        name: "run_command",
        description: "Run an approved shell command in the project directory with a timeout. Output is truncated. Dangerous commands require extra approval.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "Command to execute." },
            cwd: { type: "string", description: "Optional working directory inside the project." },
            timeout_ms: { type: "integer", description: "Timeout in milliseconds (default 120000)." }
          },
          required: ["command"]
        }
      },
      {
        name: "run_tests",
        description: "Run the project test command detected from package scripts or the ecosystem.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "Optional command override." },
            timeout_ms: { type: "integer", description: "Timeout in milliseconds." }
          },
          required: []
        }
      },
      {
        name: "run_lint",
        description: "Run the configured or detected linter/typecheck command.",
        parameters: {
          type: "object",
          properties: {
            timeout_ms: { type: "integer", description: "Timeout in milliseconds." }
          },
          required: []
        }
      },
      {
        name: "run_build",
        description: "Run the configured or detected build command.",
        parameters: {
          type: "object",
          properties: {
            timeout_ms: { type: "integer", description: "Timeout in milliseconds." }
          },
          required: []
        }
      },
      {
        name: "verify_ui",
        description: "Verify a UI in a real headless browser (requires Playwright). Navigates to an http(s) or file:// URL, captures a screenshot into .comicode/shots/, and reports console errors, page errors, and failed requests. Use after building web UI to actually check the result.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to open, e.g. http://localhost:3000 or file:///abs/path.html." },
            wait_ms: { type: "integer", description: "Extra settle time after load (default 1000, max 30000)." }
          },
          required: ["url"]
        }
      },
      {
        name: "git_status",
        description: "Show git branch, working-tree status, and untracked files. Read-only.",
        parameters: { type: "object", properties: {}, required: [] }
      },
      {
        name: "git_diff",
        description: "Show a git diff for the working tree or staged changes. Read-only.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Optional path to limit the diff." },
            staged: { type: "boolean", description: "Show staged changes instead of unstaged." },
            max_chars: { type: "integer", description: "Maximum diff characters (default 30000)." }
          },
          required: []
        }
      },
      {
        name: "update_plan",
        description: "Create or update the task plan. Use concise steps and keep statuses accurate. This is visible in the UI and saved with checkpoints.",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string", description: "One-sentence plan summary." },
            steps: {
              type: "array",
              description: "Ordered plan steps.",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  status: {
                    type: "string",
                    enum: ["pending", "in_progress", "completed", "skipped"]
                  }
                },
                required: ["title"]
              }
            }
          },
          required: ["summary", "steps"]
        }
      },
      {
        name: "task_complete",
        description: "Mark the task complete with a concise summary of changes, tests run, and any remaining caveats.",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string", description: "Final task summary for the user." }
          },
          required: ["summary"]
        }
      },
      {
        name: "environment_info",
        description: "Show OS, Node version, git state, and detected test/lint/build commands.",
        parameters: { type: "object", properties: {}, required: [] }
      },
      {
        name: "use_skill",
        description: "Load a skill by name to get detailed instructions for a kind of work (debugging, testing, review, refactoring). Skills are listed in the system context.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Skill name or unique substring." }
          },
          required: ["name"]
        }
      }
    ];
    TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));
  }
});

// src/core/ui/browser-verify.ts
var browser_verify_exports = {};
__export(browser_verify_exports, {
  verifyPage: () => verifyPage
});
import { mkdirSync as mkdirSync5 } from "fs";
import { createRequire } from "module";
import { join as join7 } from "path";
async function loadChromium(resolveFrom) {
  for (const name of ["playwright-core", "playwright"]) {
    try {
      const mod = await import(name);
      if (mod.chromium) return mod.chromium;
    } catch {
    }
    if (resolveFrom) {
      try {
        const require2 = createRequire(join7(resolveFrom, "package.json"));
        const mod = require2(name);
        const chromium = mod.chromium ?? mod.default?.chromium;
        if (chromium) return chromium;
      } catch {
      }
    }
  }
  return null;
}
async function verifyPage(url, options) {
  const chromium = await loadChromium(options.resolveFrom);
  if (!chromium) {
    return {
      ok: false,
      message: "Playwright is not installed, so no browser verification ran. Install it in this project (`npm i -D playwright && npx playwright install chromium`) or set agent.uiVerifyCommand to your own screenshot/a11y script.",
      consoleErrors: [],
      failedRequests: []
    };
  }
  const timeoutMs = options.timeoutMs ?? 3e4;
  const consoleErrors = [];
  const failedRequests = [];
  let browser = null;
  let lastLaunchError = null;
  for (const launchOptions of [
    { headless: true },
    { headless: true, channel: "msedge" },
    { headless: true, channel: "chrome" }
  ]) {
    try {
      browser = await chromium.launch(launchOptions);
      break;
    } catch (error) {
      lastLaunchError = error;
    }
  }
  if (!browser) {
    return {
      ok: false,
      message: `Could not launch a browser: ${lastLaunchError instanceof Error ? lastLaunchError.message : String(lastLaunchError)}. Install browsers with \`npx playwright install chromium\` or set agent.uiVerifyCommand.`,
      consoleErrors: [],
      failedRequests: []
    };
  }
  try {
    const page = await browser.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(String(msg.text()).slice(0, 300));
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(String(error).slice(0, 300));
    });
    page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText ?? "failed";
      failedRequests.push(`${request.url()} (${failure})`.slice(0, 300));
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        failedRequests.push(`${response.status()} ${response.url()}`.slice(0, 300));
      }
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    if (options.waitMs) await page.waitForTimeout(options.waitMs);
    mkdirSync5(options.outDir, { recursive: true });
    const screenshotPath = join7(options.outDir, `verify-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    return {
      ok: true,
      message: `Browser verification completed for ${url}. Screenshot saved.`,
      screenshotPath,
      title: await page.title().catch(() => null) ?? void 0,
      consoleErrors: consoleErrors.slice(0, 20),
      failedRequests: failedRequests.slice(0, 20)
    };
  } catch (error) {
    return {
      ok: false,
      message: `Browser verification failed: ${error instanceof Error ? error.message : String(error)}`,
      consoleErrors: consoleErrors.slice(0, 20),
      failedRequests: failedRequests.slice(0, 20)
    };
  } finally {
    await browser.close().catch(() => void 0);
  }
}
var init_browser_verify = __esm({
  "src/core/ui/browser-verify.ts"() {
    "use strict";
  }
});

// src/core/agent/tools/executor.ts
import {
  existsSync as existsSync6,
  mkdirSync as mkdirSync6,
  readFileSync as readFileSync6,
  renameSync as renameSync3,
  statSync as statSync7,
  unlinkSync as unlinkSync2,
  writeFileSync as writeFileSync2
} from "fs";
import { dirname as dirname4, join as join8 } from "path";
import { z as z3 } from "zod";
function truncateForModel(text, maxChars) {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.68);
  const tail = Math.floor(maxChars * 0.25);
  return `${text.slice(0, head)}
... [truncated ${text.length - head - tail} characters] ...
${text.slice(-tail)}`;
}
function quoteDiff(diff, maxChars) {
  if (!diff) return "";
  return diff.length > maxChars ? `${diff.slice(0, maxChars)}
... [diff truncated]` : diff;
}
function atomicWrite(absolute, content) {
  mkdirSync6(dirname4(absolute), { recursive: true });
  const temp = `${absolute}.comicode-${process.pid}-${Date.now()}.tmp`;
  writeFileSync2(temp, content, "utf8");
  renameSync3(temp, absolute);
}
function parseChangedFiles(output) {
  const files = /* @__PURE__ */ new Set();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("##")) continue;
    let path = line.slice(3).trim();
    if (path.includes(" -> ")) path = path.split(" -> ").pop().trim();
    path = path.replace(/^"|"$/g, "");
    if (path) files.add(path.replace(/\\/g, "/"));
  }
  return [...files];
}
var MAX_READ_BYTES, MAX_WRITE_BYTES, MAX_SEARCH_FILE_BYTES, pathSchema, readSchema, searchSchema, writeSchema, editSchema, patchSchema, deleteSchema, commandSchema, testsSchema, timeoutSchema, diffSchema, planSchema, completeSchema, skillSchema, verifyUiSchema, ToolExecutor;
var init_executor = __esm({
  "src/core/agent/tools/executor.ts"() {
    "use strict";
    init_modes();
    init_skills();
    init_paths2();
    init_secrets();
    init_files();
    init_diff();
    init_shell();
    init_process();
    init_redact();
    init_definitions2();
    MAX_READ_BYTES = 6e5;
    MAX_WRITE_BYTES = 2e6;
    MAX_SEARCH_FILE_BYTES = 3e5;
    pathSchema = z3.object({
      path: z3.string().min(1).max(1e3)
    });
    readSchema = pathSchema.extend({
      start_line: z3.number().int().min(1).optional(),
      end_line: z3.number().int().min(1).optional()
    });
    searchSchema = z3.object({
      pattern: z3.string().min(1).max(500),
      path: z3.string().max(1e3).optional(),
      case_sensitive: z3.boolean().optional(),
      max_results: z3.number().int().min(1).max(200).optional()
    });
    writeSchema = pathSchema.extend({ content: z3.string().max(MAX_WRITE_BYTES) });
    editSchema = pathSchema.extend({
      old_text: z3.string().min(1).max(MAX_WRITE_BYTES),
      new_text: z3.string().max(MAX_WRITE_BYTES),
      replace_all: z3.boolean().optional()
    });
    patchSchema = pathSchema.extend({ patch: z3.string().min(1).max(MAX_WRITE_BYTES) });
    deleteSchema = pathSchema.extend({ reason: z3.string().min(1).max(1e3) });
    commandSchema = z3.object({
      command: z3.string().min(1).max(4e3),
      cwd: z3.string().max(1e3).optional(),
      timeout_ms: z3.number().int().min(1e3).max(6e5).optional()
    });
    testsSchema = z3.object({
      command: z3.string().min(1).max(4e3).optional(),
      timeout_ms: z3.number().int().min(1e3).max(6e5).optional()
    });
    timeoutSchema = z3.object({ timeout_ms: z3.number().int().min(1e3).max(6e5).optional() });
    diffSchema = z3.object({
      path: z3.string().max(1e3).optional(),
      staged: z3.boolean().optional(),
      max_chars: z3.number().int().min(1e3).max(2e5).optional()
    });
    planSchema = z3.object({
      summary: z3.string().min(1).max(2e3),
      steps: z3.array(
        z3.union([
          z3.string().min(1).max(500),
          z3.object({
            title: z3.string().min(1).max(500),
            status: z3.enum(["pending", "in_progress", "completed", "skipped"]).optional()
          })
        ])
      ).min(1).max(50)
    });
    completeSchema = z3.object({ summary: z3.string().min(1).max(8e3) });
    skillSchema = z3.object({ name: z3.string().min(1).max(200) });
    verifyUiSchema = z3.object({
      url: z3.string().min(1).max(2e3),
      wait_ms: z3.number().int().min(0).max(3e4).optional()
    });
    ToolExecutor = class {
      constructor(options) {
        this.options = options;
        this.guard = new PathGuard(options.root);
      }
      options;
      guard;
      readOnlyMode() {
        return this.options.mode ? AGENT_MODES[this.options.mode].tools === "read-only" : false;
      }
      definitions() {
        if (this.readOnlyMode()) {
          return TOOL_DEFINITIONS.filter((tool) => PLAN_MODE_TOOLS.has(tool.name));
        }
        return TOOL_DEFINITIONS;
      }
      notice(message) {
        this.options.onNotice?.(message);
      }
      permissionGrants() {
        const settings = this.options.getSettings?.() ?? this.options.settings;
        return settings.agent.permissions;
      }
      /** True when a persisted "always allow" grant covers this request. */
      grantMatches(request) {
        const grants = this.permissionGrants();
        if (request.kind === "command" || request.kind === "dangerous-command" || request.kind === "ui-verify") {
          const command = request.command ?? "";
          if (!command) return false;
          return grants.allowCommands.some(
            (grant) => grant.endsWith("*") ? command.startsWith(grant.slice(0, -1)) : command === grant
          );
        }
        if (request.path) {
          const target = request.path.replace(/\\/g, "/").replace(/^\.\//, "");
          return grants.allowPaths.some((grant) => {
            const base = grant.replace(/\\/g, "/").replace(/\/+$/, "");
            return target === base || target.startsWith(`${base}/`);
          });
        }
        return false;
      }
      async approve(request, auto) {
        if (auto) return true;
        const settings = this.options.getSettings?.() ?? this.options.settings;
        const mode = settings.agent.permissionMode ?? "ask";
        if (mode === "auto") return true;
        if (mode === "trusted" && request.kind !== "dangerous-command" && request.kind !== "secret-read") {
          return true;
        }
        if (this.grantMatches(request)) {
          this.notice(`Allowed by saved permission: ${request.title}.`);
          return true;
        }
        if (!this.options.confirm) {
          this.notice(
            `Approval required for ${request.title}, but no interactive confirmation is available. Re-run with --yes (and --allow-commands for shell commands) or enable auto-approval in settings.`
          );
          return false;
        }
        try {
          const decision = await this.options.confirm(request);
          if (decision === "always") {
            this.options.onGrant?.(request);
            return true;
          }
          return decision === "allow";
        } catch {
          return false;
        }
      }
      writesAuto() {
        return this.options.settings.agent.autoApproveFileEdits || this.options.authority.allowFileWrites;
      }
      commandsAuto() {
        return this.options.settings.agent.autoApproveCommands || this.options.authority.allowCommands;
      }
      secretsAllowed() {
        return this.options.settings.agent.allowSecretAccess || this.options.authority.allowSecrets;
      }
      async confirmSecret(relative4, action) {
        if (this.secretsAllowed()) return true;
        return this.approve(
          {
            kind: "secret-read",
            title: `${action} protected file`,
            description: "This file may contain credentials. Its contents could be sent to the selected AI provider.",
            path: relative4
          },
          false
        );
      }
      async execute(call) {
        if (this.readOnlyMode() && !PLAN_MODE_TOOLS.has(call.name)) {
          return {
            ok: false,
            content: `Tool ${call.name} is not available in ${this.options.mode} mode. Inspect and update the plan instead.`
          };
        }
        try {
          switch (call.name) {
            case "list_files":
              return await this.listFiles(call.arguments);
            case "read_file":
              return await this.readFile(call.arguments);
            case "search_files":
              return await this.searchFiles(call.arguments);
            case "write_file":
              return await this.writeFile(call.arguments);
            case "edit_file":
              return await this.editFile(call.arguments);
            case "apply_patch":
              return await this.applyPatch(call.arguments);
            case "delete_file":
              return await this.deleteFile(call.arguments);
            case "run_command":
              return await this.runCommandTool(call.arguments);
            case "run_tests":
              return await this.runPreset("test", call.arguments);
            case "run_lint":
              return await this.runPreset("lint", call.arguments);
            case "run_build":
              return await this.runPreset("build", call.arguments);
            case "verify_ui":
              return await this.verifyUiTool(call.arguments);
            case "git_status":
              return await this.gitStatus();
            case "git_diff":
              return await this.gitDiff(call.arguments);
            case "update_plan":
              return this.updatePlan(call.arguments);
            case "task_complete":
              return this.taskComplete(call.arguments);
            case "environment_info":
              return await this.environmentInfo();
            case "use_skill":
              return this.useSkill(call.arguments);
            default:
              return { ok: false, content: `Unknown tool: ${call.name}` };
          }
        } catch (error) {
          if (error instanceof PathSafetyError) {
            return { ok: false, content: `Safety error: ${error.message}` };
          }
          return {
            ok: false,
            content: `Tool failed: ${redactSecrets(error instanceof Error ? error.message : String(error))}`
          };
        }
      }
      parse(schema, args) {
        const parsed = schema.safeParse(args ?? {});
        if (parsed.success) return { ok: true, data: parsed.data };
        const issues = parsed.error.issues.slice(0, 6).map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`).join("; ");
        return { ok: false, result: { ok: false, content: `Invalid tool arguments: ${issues}` } };
      }
      async listFiles(args) {
        const parsed = this.parse(
          z3.object({
            path: z3.string().max(1e3).optional(),
            limit: z3.number().int().min(1).max(1e3).optional()
          }),
          args
        );
        if (!parsed.ok) return parsed.result;
        const limit = parsed.data.limit ?? 200;
        let prefix = "";
        if (parsed.data.path) {
          const absolute = this.guard.resolvePath(parsed.data.path, { mustExist: true });
          const stats = statSync7(absolute);
          if (stats.isFile()) return { ok: true, content: this.guard.relative(absolute) };
          prefix = this.guard.relative(absolute);
          if (prefix === ".") prefix = "";
        }
        const files = await listProjectFiles(this.options.root, 5e3);
        const filtered = files.filter((file) => !isSecretFile(file.path)).filter((file) => !prefix || file.path === prefix || file.path.startsWith(`${prefix}/`)).slice(0, limit);
        if (filtered.length === 0) {
          return { ok: true, content: prefix ? `No files found under ${prefix}.` : "No files found." };
        }
        const lines = filtered.map((file) => `${file.path} (${file.size} bytes)`);
        const more = files.length > filtered.length ? `
... more files omitted; increase limit or narrow path` : "";
        return {
          ok: true,
          content: `Files (${filtered.length}):
${lines.join("\n")}${more}`
        };
      }
      async readFile(args) {
        const parsed = this.parse(readSchema, args);
        if (!parsed.ok) return parsed.result;
        const absolute = this.guard.resolvePath(parsed.data.path, { mustExist: true });
        const relative4 = this.guard.relative(absolute);
        const stats = statSync7(absolute);
        if (stats.isDirectory())
          return { ok: false, content: `${relative4} is a directory; use list_files.` };
        if (isSecretFile(relative4) && !await this.confirmSecret(relative4, "Read")) {
          return { ok: false, content: `Reading ${relative4} was not approved.` };
        }
        if (stats.size > MAX_READ_BYTES) {
          return {
            ok: false,
            content: `File ${relative4} is ${stats.size} bytes (limit ${MAX_READ_BYTES}). Use search_files or read a smaller generated section.`
          };
        }
        const buffer = readFileSync6(absolute);
        if (isBinaryBuffer(buffer)) return { ok: false, content: `${relative4} appears to be binary.` };
        let text = buffer.toString("utf8");
        if (looksLikePrivateKey(text) && !await this.confirmSecret(relative4, "Read private key")) {
          return { ok: false, content: `Reading a private key file was not approved.` };
        }
        const lines = text.split(/\r?\n/);
        const total = lines.length;
        let start = parsed.data.start_line ?? 1;
        let end = parsed.data.end_line ?? total;
        if (start > end) [start, end] = [end, start];
        start = Math.max(1, start);
        end = Math.min(total, end);
        text = lines.slice(start - 1, end).join("\n");
        const maxChars = Math.max(4e3, this.options.settings.agent.maxToolOutputChars);
        return {
          ok: true,
          content: truncateForModel(
            `# ${relative4} (lines ${start}-${end} of ${total})
${text}`,
            maxChars
          ),
          metadata: { path: relative4, totalLines: total, start, end }
        };
      }
      async searchFiles(args) {
        const parsed = this.parse(searchSchema, args);
        if (!parsed.ok) return parsed.result;
        let regex;
        try {
          regex = new RegExp(parsed.data.pattern, parsed.data.case_sensitive ? "" : "i");
        } catch (error) {
          return {
            ok: false,
            content: `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`
          };
        }
        let prefix = "";
        if (parsed.data.path) {
          const absolute = this.guard.resolvePath(parsed.data.path);
          prefix = this.guard.relative(absolute);
          if (prefix === ".") prefix = "";
        }
        const maxResults = parsed.data.max_results ?? 60;
        const files = await listProjectFiles(this.options.root, 5e3);
        const matches = [];
        let scanned = 0;
        for (const file of files) {
          if (matches.length >= maxResults) break;
          if (isSecretFile(file.path)) continue;
          if (prefix && !file.path.startsWith(`${prefix}/`) && file.path !== prefix) continue;
          if (file.size > MAX_SEARCH_FILE_BYTES) continue;
          try {
            const buffer = readFileSync6(join8(this.options.root, file.path));
            if (isBinaryBuffer(buffer)) continue;
            scanned += 1;
            const lines = buffer.toString("utf8").split(/\r?\n/);
            for (let index = 0; index < lines.length; index += 1) {
              const line = lines[index] ?? "";
              if (regex.test(line)) {
                matches.push(`${file.path}:${index + 1}: ${line.trim().slice(0, 240)}`);
                if (matches.length >= maxResults) break;
              }
            }
          } catch {
          }
        }
        if (matches.length === 0) {
          return { ok: true, content: `No matches for /${parsed.data.pattern}/ in ${scanned} files.` };
        }
        return {
          ok: true,
          content: `Matches (${matches.length}${matches.length >= maxResults ? "+ limited" : ""}):
${matches.join("\n")}`
        };
      }
      async writeFile(args) {
        const parsed = this.parse(writeSchema, args);
        if (!parsed.ok) return parsed.result;
        const absolute = this.guard.assertWritable(parsed.data.path);
        const relative4 = this.guard.relative(absolute);
        if (existsSync6(absolute) && statSync7(absolute).isDirectory()) {
          return { ok: false, content: `${relative4} is a directory.` };
        }
        const existed = existsSync6(absolute);
        const previous = existed ? readFileSync6(absolute, "utf8") : "";
        if (previous === parsed.data.content) {
          return { ok: true, content: `${relative4} is already up to date.` };
        }
        const diff = createUnifiedDiff(relative4, previous, parsed.data.content);
        const approved = await this.approve(
          {
            kind: "file-write",
            title: existed ? `Overwrite ${relative4}` : `Create ${relative4}`,
            description: existed ? "Replace the entire file with new content." : "Create a new file.",
            path: relative4,
            diff: quoteDiff(diff, 2e4)
          },
          this.writesAuto()
        );
        if (!approved) return { ok: false, content: `Writing ${relative4} was not approved.` };
        atomicWrite(absolute, parsed.data.content);
        return {
          ok: true,
          content: `${existed ? "Wrote" : "Created"} ${relative4}.
${quoteDiff(diff, 8e3)}`,
          changedFiles: [relative4],
          diff
        };
      }
      async editFile(args) {
        const parsed = this.parse(editSchema, args);
        if (!parsed.ok) return parsed.result;
        const absolute = this.guard.assertWritable(parsed.data.path);
        const relative4 = this.guard.relative(absolute);
        if (!existsSync6(absolute))
          return { ok: false, content: `${relative4} does not exist. Use write_file to create it.` };
        const previous = readFileSync6(absolute, "utf8");
        const occurrences = previous.split(parsed.data.old_text).length - 1;
        if (occurrences === 0) {
          return {
            ok: false,
            content: `old_text was not found in ${relative4}. Read the file again and copy the exact text.`
          };
        }
        if (occurrences > 1 && !parsed.data.replace_all) {
          return {
            ok: false,
            content: `old_text occurs ${occurrences} times in ${relative4}. Provide more context or set replace_all=true.`
          };
        }
        const updated = parsed.data.replace_all ? previous.split(parsed.data.old_text).join(parsed.data.new_text) : previous.replace(parsed.data.old_text, parsed.data.new_text);
        const diff = createUnifiedDiff(relative4, previous, updated);
        const approved = await this.approve(
          {
            kind: "file-write",
            title: `Edit ${relative4}`,
            description: parsed.data.replace_all ? `Replace ${occurrences} occurrences.` : "Replace one text block.",
            path: relative4,
            diff: quoteDiff(diff, 2e4)
          },
          this.writesAuto()
        );
        if (!approved) return { ok: false, content: `Editing ${relative4} was not approved.` };
        atomicWrite(absolute, updated);
        return {
          ok: true,
          content: `Edited ${relative4} (${occurrences} replacement${occurrences === 1 ? "" : "s"}).
${quoteDiff(diff, 8e3)}`,
          changedFiles: [relative4],
          diff
        };
      }
      async applyPatch(args) {
        const parsed = this.parse(patchSchema, args);
        if (!parsed.ok) return parsed.result;
        const absolute = this.guard.assertWritable(parsed.data.path);
        const relative4 = this.guard.relative(absolute);
        if (!existsSync6(absolute)) return { ok: false, content: `${relative4} does not exist.` };
        const previous = readFileSync6(absolute, "utf8");
        let updated;
        try {
          updated = applyUnifiedPatch(previous, parsed.data.patch);
        } catch (error) {
          return {
            ok: false,
            content: `Patch failed: ${error instanceof Error ? error.message : String(error)}`
          };
        }
        const diff = createUnifiedDiff(relative4, previous, updated);
        const approved = await this.approve(
          {
            kind: "file-write",
            title: `Apply patch to ${relative4}`,
            description: "Apply the supplied unified diff.",
            path: relative4,
            diff: quoteDiff(diff, 2e4)
          },
          this.writesAuto()
        );
        if (!approved) return { ok: false, content: `Patching ${relative4} was not approved.` };
        atomicWrite(absolute, updated);
        return {
          ok: true,
          content: `Applied patch to ${relative4}.
${quoteDiff(diff, 8e3)}`,
          changedFiles: [relative4],
          diff
        };
      }
      async deleteFile(args) {
        const parsed = this.parse(deleteSchema, args);
        if (!parsed.ok) return parsed.result;
        const absolute = this.guard.assertWritable(parsed.data.path);
        const relative4 = this.guard.relative(absolute);
        if (!existsSync6(absolute)) return { ok: false, content: `${relative4} does not exist.` };
        if (statSync7(absolute).isDirectory()) {
          return {
            ok: false,
            content: `Refusing to delete directory ${relative4}. Remove files individually.`
          };
        }
        const approved = await this.approve(
          {
            kind: "file-delete",
            title: `Delete ${relative4}`,
            description: parsed.data.reason,
            path: relative4
          },
          false
        );
        if (!approved) return { ok: false, content: `Deleting ${relative4} was not approved.` };
        unlinkSync2(absolute);
        return { ok: true, content: `Deleted ${relative4}.`, changedFiles: [relative4] };
      }
      async runCommandTool(args) {
        const parsed = this.parse(commandSchema, args);
        if (!parsed.ok) return parsed.result;
        return this.executeShell(parsed.data.command, {
          cwd: parsed.data.cwd,
          timeoutMs: parsed.data.timeout_ms
        });
      }
      async verifyUiTool(args) {
        const parsed = this.parse(verifyUiSchema, args);
        if (!parsed.ok) return parsed.result;
        const url = parsed.data.url;
        if (!/^(https?|file):\/\//i.test(url)) {
          return {
            ok: false,
            content: "verify_ui only supports http://, https://, or file:// URLs."
          };
        }
        const approved = await this.approve(
          {
            kind: "ui-verify",
            title: `Verify UI: ${url}`,
            description: "Launch a headless browser, capture a screenshot, and report console errors and failed requests.",
            command: `verify_ui ${url}`
          },
          this.commandsAuto()
        );
        if (!approved) return { ok: false, content: "UI verification was not approved." };
        const { verifyPage: verifyPage2 } = await Promise.resolve().then(() => (init_browser_verify(), browser_verify_exports));
        const relative4 = ".comicode/shots";
        const result = await verifyPage2(url, {
          waitMs: parsed.data.wait_ms ?? 1e3,
          outDir: join8(this.options.root, relative4),
          timeoutMs: 3e4,
          resolveFrom: this.options.root
        });
        if (!result.ok) return { ok: false, content: result.message };
        const lines = [
          result.message,
          result.title ? `Title: ${result.title}` : null,
          result.screenshotPath ? `Screenshot: ${join8(relative4, result.screenshotPath.split(/[\\/]/).pop() ?? "")}` : null,
          result.consoleErrors.length ? `Console errors:
${result.consoleErrors.map((e) => `- ${e}`).join("\n")}` : "Console errors: none",
          result.failedRequests.length ? `Failed requests:
${result.failedRequests.map((r) => `- ${r}`).join("\n")}` : "Failed requests: none"
        ].filter(Boolean);
        return { ok: true, content: lines.join("\n") };
      }
      async runPreset(kind, args) {
        const parsed = this.parse(kind === "test" ? testsSchema : timeoutSchema, args);
        if (!parsed.ok) return parsed.result;
        const detected = this.options.inspector.detectCommands();
        const configured = kind === "test" ? this.options.settings.agent.testCommand : kind === "lint" ? this.options.settings.agent.lintCommand : this.options.settings.agent.buildCommand;
        const override = parsed.data && "command" in parsed.data && typeof parsed.data.command === "string" ? parsed.data.command : null;
        const command = override || configured || detected[kind];
        if (!command) {
          return {
            ok: false,
            content: `No ${kind} command is configured or detected. Configure agent.${kind}Command or run_command explicitly.`
          };
        }
        const timeoutMs = parsed.data && "timeout_ms" in parsed.data ? parsed.data.timeout_ms : void 0;
        return this.executeShell(command, { timeoutMs });
      }
      async executeShell(command, options = {}) {
        const cwd = options.cwd ? this.guard.resolvePath(options.cwd, { mustExist: true }) : this.options.root;
        if (!statSync7(cwd).isDirectory()) {
          return { ok: false, content: `${options.cwd} is not a directory.` };
        }
        const safety = inspectCommand(command);
        if (safety.blocked) {
          return {
            ok: false,
            content: `Command blocked by safety policy: ${safety.reasons.join("; ")}.`
          };
        }
        const dangerous = safety.dangerous;
        const auto = this.commandsAuto() && (!dangerous || this.options.authority.allowDangerousCommands);
        if (dangerous && !this.options.authority.allowDangerousCommands && !this.options.confirm) {
          return {
            ok: false,
            content: `Command requires dangerous-command approval: ${safety.reasons.join("; ")}.`
          };
        }
        const approved = await this.approve(
          {
            kind: dangerous ? "dangerous-command" : "command",
            title: dangerous ? "Run risky command" : "Run command",
            description: dangerous ? `This command matches risky patterns: ${safety.reasons.join("; ")}` : "Execute a shell command in the project directory.",
            command: redactSecrets(command),
            reasons: safety.reasons
          },
          auto
        );
        if (!approved) return { ok: false, content: "Command was not approved." };
        const result = await runShell(command, {
          cwd,
          timeoutMs: options.timeoutMs,
          maxOutputBytes: 8e4
        });
        const changedFiles = await this.gitChangedFiles();
        const content = truncateForModel(
          summarizeShellResult(result),
          this.options.settings.agent.maxToolOutputChars
        );
        return {
          ok: result.code === 0 && !result.timedOut,
          content,
          changedFiles,
          metadata: { exitCode: result.code, timedOut: result.timedOut }
        };
      }
      async gitChangedFiles() {
        const result = await runProcess("git", ["status", "--porcelain=v1"], {
          cwd: this.options.root,
          timeoutMs: 1e4,
          maxOutputBytes: 2e5
        });
        if (result.spawnError || result.code !== 0) return [];
        return parseChangedFiles(result.stdout);
      }
      async gitStatus() {
        const result = await runProcess("git", ["status", "--porcelain=v1", "-b"], {
          cwd: this.options.root,
          timeoutMs: 1e4,
          maxOutputBytes: 2e5
        });
        if (result.spawnError || result.code !== 0) {
          return { ok: false, content: "Not a git repository or git is unavailable." };
        }
        const changed = parseChangedFiles(result.stdout);
        return {
          ok: true,
          content: `Git status:
${result.stdout.trim() || "clean"}`,
          changedFiles: changed
        };
      }
      async gitDiff(args) {
        const parsed = this.parse(diffSchema, args);
        if (!parsed.ok) return parsed.result;
        const gitArgs = ["diff", "--no-color"];
        if (parsed.data.staged) gitArgs.push("--cached");
        if (parsed.data.path) {
          const absolute = this.guard.resolvePath(parsed.data.path);
          gitArgs.push("--", this.guard.relative(absolute));
        }
        const result = await runProcess("git", gitArgs, {
          cwd: this.options.root,
          timeoutMs: 2e4,
          maxOutputBytes: 4e5
        });
        if (result.spawnError || result.code !== 0) {
          return { ok: false, content: "Unable to produce a git diff. Is this a git repository?" };
        }
        if (!result.stdout.trim()) {
          const status = await this.gitStatus();
          return {
            ok: true,
            content: `No ${parsed.data.staged ? "staged" : "unstaged"} diff. ${status.content}`
          };
        }
        const max = parsed.data.max_chars ?? 3e4;
        return {
          ok: true,
          content: truncateForModel(result.stdout, max),
          diff: result.stdout.slice(0, 1e5)
        };
      }
      updatePlan(args) {
        const parsed = this.parse(planSchema, args);
        if (!parsed.ok) return parsed.result;
        const steps = parsed.data.steps.map(
          (entry) => typeof entry === "string" ? { title: entry, status: "pending" } : { title: entry.title, status: entry.status ?? "pending" }
        );
        const plan = {
          summary: parsed.data.summary,
          steps,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        this.options.onPlan?.(plan);
        return {
          ok: true,
          content: `Plan saved:
${steps.map((step) => `- [${step.status}] ${step.title}`).join("\n")}`,
          metadata: { plan }
        };
      }
      taskComplete(args) {
        const parsed = this.parse(completeSchema, args);
        if (!parsed.ok) return parsed.result;
        this.options.onTaskComplete?.(parsed.data.summary);
        return { ok: true, content: "Task marked complete." };
      }
      useSkill(args) {
        const parsed = this.parse(skillSchema, args);
        if (!parsed.ok) return parsed.result;
        const skills = this.options.skills ?? [];
        if (skills.length === 0) {
          return { ok: false, content: "No skills are available in this project." };
        }
        const skill = findSkill(skills, parsed.data.name);
        if (!skill) {
          const names = skills.map((entry) => entry.name).join(", ");
          return { ok: false, content: `Unknown skill "${parsed.data.name}". Available: ${names}` };
        }
        return {
          ok: true,
          content: `# Skill: ${skill.name}
${skill.description}

${skill.content}`,
          metadata: { skill: skill.name, source: skill.source }
        };
      }
      async environmentInfo() {
        const detected = this.options.inspector.detectCommands();
        const snapshot = await this.options.inspector.snapshot();
        return {
          ok: true,
          content: [
            `OS: ${process.platform} ${process.arch}`,
            `Node: ${process.version}`,
            `Project: ${snapshot.name} (${snapshot.root})`,
            `Git: ${snapshot.git.isRepo ? `${snapshot.git.branch ?? "detached"}${snapshot.git.status ? " (dirty)" : " (clean)"}` : "not a repository"}`,
            `Package manager: ${detected.packageManager ?? "none detected"}`,
            `Test: ${detected.test ?? "none"}`,
            `Lint: ${detected.lint ?? "none"}`,
            `Build: ${detected.build ?? "none"}`,
            `Environment variables provided to commands exclude known credential names.`
          ].join("\n")
        };
      }
    };
  }
});

// src/core/agent/context.ts
import { readFileSync as readFileSync7 } from "fs";
import { join as join9 } from "path";
import { createHash as createHash3 } from "crypto";
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
function fileExcerpt(path, root, maxChars) {
  if (isSecretFile(path)) return null;
  try {
    const buffer = readFileSync7(join9(root, path));
    if (isBinaryBuffer(buffer) || buffer.length > 8e5) return null;
    const full = buffer.toString("utf8");
    const hash = createHash3("sha256").update(buffer).digest("hex");
    let text = full;
    if (text.length > maxChars) {
      const lines = text.split(/\r?\n/);
      const head = lines.slice(0, Math.max(40, Math.floor(lines.length * 0.5))).join("\n");
      text = `${head}
... [file truncated for context: ${lines.length} lines total] ...`;
      if (text.length > maxChars) text = text.slice(0, maxChars);
    }
    return { text, hash };
  } catch {
    return null;
  }
}
function summarizeDropped(messages) {
  if (messages.length === 0) return "";
  const parts = [];
  for (const message of messages.slice(-30)) {
    if (message.role === "user") {
      parts.push(`User: ${message.content.replace(/\s+/g, " ").slice(0, 220)}`);
    } else if (message.role === "assistant") {
      const tools = message.toolCalls?.map((call) => call.name).join(", ");
      const text = message.content.replace(/\s+/g, " ").slice(0, 160);
      parts.push(`Assistant${text ? `: ${text}` : ""}${tools ? ` [tools: ${tools}]` : ""}`);
    } else if (message.role === "tool") {
      parts.push(
        `Tool ${message.name}${message.isError ? " (error)" : ""}: ${message.content.replace(/\s+/g, " ").slice(0, 180)}`
      );
    }
  }
  return parts.join("\n");
}
function toBlocks(messages) {
  const blocks = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === "tool") {
      const last = blocks[blocks.length - 1];
      if (last) {
        last.messages.push(message);
        last.chars += message.content.length;
      } else {
        blocks.push({ messages: [message], chars: message.content.length });
      }
      continue;
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      const group = [message];
      let chars = message.content.length;
      let cursor = index + 1;
      while (cursor < messages.length && messages[cursor]?.role === "tool") {
        const toolMessage = messages[cursor];
        group.push(toolMessage);
        chars += toolMessage.content.length;
        cursor += 1;
      }
      blocks.push({ messages: group, chars });
      index = cursor - 1;
      continue;
    }
    blocks.push({ messages: [message], chars: message.content.length });
  }
  return blocks;
}
function pruneHistory(messages, maxChars) {
  if (messages.reduce((sum, message) => sum + message.content.length, 0) <= maxChars) {
    return { messages, summary: "", dropped: 0 };
  }
  const blocks = toBlocks(messages);
  const kept = [];
  let total = 0;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (kept.length >= 2 && total + block.chars > maxChars) break;
    kept.unshift(block);
    total += block.chars;
  }
  const keptCount = kept.reduce((sum, block) => sum + block.messages.length, 0);
  const droppedMessages = messages.slice(0, Math.max(0, messages.length - keptCount));
  return {
    messages: kept.flatMap((block) => block.messages),
    summary: summarizeDropped(droppedMessages),
    dropped: droppedMessages.length
  };
}
var COMI_SYSTEM_PROMPT, CONTENT_LIMIT_PER_FILE, MAX_CONTEXT_FILES, MAX_PROMPT_CHARS, ContextBuilder;
var init_context = __esm({
  "src/core/agent/context.ts"() {
    "use strict";
    init_secrets();
    init_files();
    init_skills();
    init_modes();
    COMI_SYSTEM_PROMPT = `You are ComiCode, a precise, tool-using coding agent running inside the user's terminal.
You modify a real project on the user's machine. Accuracy and safety matter more than speed.

Operating rules:
1. Understand before changing. Inspect the project structure and read relevant files first. Use tools instead of guessing.
2. Keep changes focused on the user's request. Avoid unrelated refactors and do not delete code without a reason.
3. Use the provided tools. Never claim you ran a command, read a file, or saw output unless a tool actually returned it.
4. Prefer edit_file or apply_patch over rewriting whole files. Use write_file only for new files or deliberate full rewrites.
5. Verify work: run focused tests, lint, or build when available. Fix failures you introduced.
6. Commands and writes may require user approval. If approval is denied, adapt or stop and explain. Never try to bypass safety checks.
7. Never exfiltrate secrets. Do not open .env files, private keys, or credential stores unless the user explicitly requested it and approved access. Never place API keys in source code or logs.
8. Do not modify .git/ or .comicode/ internals.
9. Use update_plan for multi-step work, and call task_complete when the task is genuinely finished. Summarize changed files, tests run, and unresolved caveats.
10. Keep assistant messages concise. Large file contents belong in tools, not in prose.
11. Context may be summarized or pruned. If you need an exact current file, read it again. On resume, verify the working tree instead of assuming your previous changes are present.
12. Paths are relative to the project root. Work only inside this project. Shell commands can access the machine, so treat them with care.
13. If no suitable model/provider is available, the task will pause. Do not pretend work succeeded.
14. You cannot ask the user interactive questions mid-task. Make reasonable, minimal decisions and state assumptions in the final summary.

You are not a chatbot that only suggests code. You are expected to inspect, edit, and verify the project with tools.`;
    CONTENT_LIMIT_PER_FILE = 4500;
    MAX_CONTEXT_FILES = 6;
    MAX_PROMPT_CHARS = 12e4;
    ContextBuilder = class {
      build(input) {
        const { task, model, settings, inspector, relevantFiles, cache } = input;
        const contextWindow = model.contextWindow ?? 32e3;
        const ratio = settings.agent.contextBudgetRatio;
        const maxPromptChars = Math.max(
          12e3,
          Math.min(MAX_PROMPT_CHARS, Math.floor(contextWindow * ratio * 4))
        );
        const reserveForHistory = Math.floor(maxPromptChars * 0.5);
        const contextBudget = Math.max(6e3, maxPromptChars - reserveForHistory - 5e3);
        const lines = [];
        lines.push("# Project");
        lines.push(
          (input.projectSummary ?? "Project summary unavailable. Use list_files and read_file to inspect the project.").slice(0, 6e3)
        );
        lines.push("\n# Task state");
        lines.push(`Task ID: ${task.id}`);
        lines.push(`Project: ${task.projectName} (${task.projectPath})`);
        lines.push(`Phase: ${task.phase} | Status: ${task.status}`);
        lines.push(`User request:
${task.userRequest.slice(0, 2e3)}`);
        if (task.plan) {
          lines.push(`Plan: ${task.plan.summary}`);
          for (const step of task.plan.steps) lines.push(`- [${step.status}] ${step.title}`);
        }
        if (task.pendingSteps.length) {
          lines.push(`Pending steps:
${task.pendingSteps.map((step) => `- ${step}`).join("\n")}`);
        }
        if (task.completedSteps.length) {
          lines.push(`Completed steps:
${task.completedSteps.map((step) => `- ${step}`).join("\n")}`);
        }
        if (task.changedFiles.length) {
          lines.push(`Changed files so far: ${task.changedFiles.join(", ")}`);
        }
        if (input.summary) lines.push(`Earlier work summary:
${input.summary.slice(0, 2e3)}`);
        if (input.resumeNote) lines.push(`Resume context:
${input.resumeNote.slice(0, 3e3)}`);
        lines.push("\n# Relevant files");
        const included = [];
        const unchanged = [];
        let usedChars = lines.join("\n").length;
        let filesAdded = 0;
        for (const entry of relevantFiles) {
          if (filesAdded >= MAX_CONTEXT_FILES) break;
          if (usedChars >= contextBudget) break;
          const excerpt = fileExcerpt(entry.path, inspector.root, CONTENT_LIMIT_PER_FILE);
          if (!excerpt) continue;
          const cached = cache[entry.path];
          const changedFile = task.changedFiles.includes(entry.path);
          if (cached && cached.hash === excerpt.hash && !changedFile) {
            unchanged.push(entry.path);
            continue;
          }
          const budgetLeft = contextBudget - usedChars;
          if (budgetLeft < 800) break;
          const clipped = excerpt.text.length > budgetLeft ? `${excerpt.text.slice(0, Math.max(400, budgetLeft - 200))}
... [clipped to context budget]` : excerpt.text;
          lines.push(`
--- ${entry.path} (${entry.reason}) ---
${clipped}`);
          usedChars += clipped.length + entry.path.length + 50;
          filesAdded += 1;
          included.push(entry.path);
          cache[entry.path] = {
            hash: excerpt.hash,
            sentAt: (/* @__PURE__ */ new Date()).toISOString(),
            note: entry.reason
          };
        }
        if (filesAdded === 0) {
          lines.push(
            "No new file excerpts were added. Use read_file/search_files when you need content; relevant files may be unchanged since a previous turn."
          );
        }
        if (unchanged.length) {
          lines.push(
            `
Unchanged files already provided earlier (read again if exact content is needed): ${unchanged.slice(0, 20).join(", ")}`
          );
        }
        const skillsSection = formatSkillsSection(input.skills ?? []);
        if (skillsSection) lines.push(`
${skillsSection}`);
        const modeAddendum = input.mode ? AGENT_MODES[input.mode].promptAddendum : "";
        if (modeAddendum) lines.push(`
${modeAddendum}`);
        if (input.effortHint) lines.push(`
${input.effortHint}`);
        lines.push(
          "\n# Task breakdown\nFor any request involving multiple files, layers, or steps (e.g. fullstack work), first call update_plan with a concrete decomposition \u2014 separate subtasks for each layer/component plus verification \u2014 then execute the steps in order, keeping the plan statuses accurate."
        );
        lines.push(
          "\n# Context guidance\nTool results can be truncated. Use search/read tools for exact current content. Do not assume a file still matches something you saw many turns ago."
        );
        const contextText = lines.join("\n").slice(0, contextBudget + 6e3);
        const historyBudget = Math.max(6e3, Math.floor(maxPromptChars * 0.32));
        const pruned = pruneHistory(input.history, historyBudget);
        const summary = [task.summary, pruned.summary].filter(Boolean).join("\n\n");
        const messages = [
          { role: "system", content: COMI_SYSTEM_PROMPT },
          { role: "system", content: contextText },
          ...pruned.messages
        ];
        const estimatedTokens = messages.reduce(
          (sum, message) => sum + estimateTokens(message.content) + 8,
          0
        );
        return {
          system: COMI_SYSTEM_PROMPT,
          contextText,
          messages,
          summary,
          cache,
          estimatedTokens
        };
      }
    };
  }
});

// src/core/agent/collaboration.ts
import { readFileSync as readFileSync8, statSync as statSync8 } from "fs";
import { join as join10 } from "path";
function parseUsageFromText(text) {
  const output = estimateTokens(text);
  return { inputTokens: 0, outputTokens: output, totalTokens: output };
}
function planFromCollaborator(text) {
  const lines = text.split(/\r?\n/);
  const steps = [];
  for (const line of lines) {
    const match = /^\s*(?:[-*]|\d+[.)])\s+(.+)$/.exec(line);
    if (match?.[1]) steps.push({ title: match[1].trim().slice(0, 400), status: "pending" });
    if (steps.length >= 12) break;
  }
  const summary = lines.find((line) => line.trim() && !/^\s*(?:[-*]|\d+[.)])\s+/.test(line))?.trim().slice(0, 500) || "Planner proposal";
  return {
    summary,
    steps: steps.length ? steps : [{ title: "Inspect the project and implement the request", status: "pending" }],
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
var Collaborator;
var init_collaboration = __esm({
  "src/core/agent/collaboration.ts"() {
    "use strict";
    init_registry();
    init_service();
    init_errors();
    init_secrets();
    init_process();
    init_context();
    Collaborator = class {
      constructor(store, inspector, settings, hooks) {
        this.store = store;
        this.inspector = inspector;
        this.settings = settings;
        this.hooks = hooks;
      }
      store;
      inspector;
      settings;
      hooks;
      resolveProfileModel(profileId) {
        if (!profileId) return null;
        const profile = this.store.getProfile(profileId);
        if (!profile || !profile.enabled) return null;
        const models = this.store.listModels(profile.providerId, profile.providerId === "custom" ? profile.id : void 0).filter((model) => model.profileId === null || model.profileId === profile.id);
        const preferred = models.find(
          (model) => model.modelId === profile.defaultModel && model.available
        );
        const catalogModel = preferred ?? models.find((model) => model.available && model.supportsTools);
        if (!catalogModel) {
          const modelId = profile.defaultModel;
          if (!modelId) return null;
          const synthetic = {
            id: `${profile.providerId}:${modelId}`,
            providerId: profile.providerId,
            profileId: profile.providerId === "custom" ? profile.id : null,
            modelId,
            displayName: modelId,
            contextWindow: null,
            maxOutputTokens: null,
            supportsTools: true,
            supportsStreaming: true,
            supportsVision: false,
            codingSuitability: 2,
            reasoningSuitability: 2,
            inputPricePerMillion: null,
            outputPricePerMillion: null,
            access: "unknown",
            accessSource: "collaboration",
            accessNotes: null,
            available: true,
            lastCheckedAt: null,
            userClassification: null,
            metadata: {}
          };
          return { profile, model: synthetic };
        }
        return { profile, model: catalogModel };
      }
      recordUsage(taskId, profile, model, usage2) {
        const cost = model.inputPricePerMillion !== null && model.outputPricePerMillion !== null ? usage2.inputTokens / 1e6 * model.inputPricePerMillion + usage2.outputTokens / 1e6 * model.outputPricePerMillion : null;
        this.store.recordUsage({
          taskId,
          profileId: profile.id,
          providerId: profile.providerId,
          modelId: model.modelId,
          inputTokens: usage2.inputTokens,
          outputTokens: usage2.outputTokens,
          costEstimate: cost,
          source: "collaboration"
        });
      }
      async plan(task, projectSummary) {
        const target = this.resolveProfileModel(this.settings.agent.collaboration.plannerProfileId);
        if (!target) return null;
        const prompt = [
          "Create a concise implementation plan for the coding task below.",
          "Return a one-sentence summary and then 3-10 numbered steps. Do not write code.",
          "",
          `Project summary:
${projectSummary.slice(0, 12e3)}`,
          "",
          `Task request:
${task.userRequest}`,
          "",
          task.plan ? `Existing plan:
${task.plan.steps.map((step) => `- ${step.title}`).join("\n")}` : ""
        ].filter(Boolean).join("\n");
        try {
          const result = await this.call(
            target.profile,
            target.model,
            [
              { role: "system", content: "You are a senior software planner. Be concrete and brief." },
              { role: "user", content: prompt }
            ],
            2e3
          );
          this.recordUsage(
            task.id,
            target.profile,
            target.model,
            result.usage ?? parseUsageFromText(result.text)
          );
          this.store.recordRoutingEvent({
            taskId: task.id,
            toProfileId: target.profile.id,
            toModelId: target.model.modelId,
            reason: "Planner collaboration pass",
            category: "collaboration"
          });
          return { text: result.text, profileId: target.profile.id, modelId: target.model.modelId };
        } catch (error) {
          const classified = classifyThrown(error, target.profile.providerId);
          this.recordFailure(target.profile, target.model, classified.category, classified.message);
          this.hooks.onNotice?.(
            `Planner pass unavailable (${classified.category}): ${classified.message}`
          );
          return null;
        }
      }
      async review(task, changedFiles, summary) {
        const target = this.resolveProfileModel(this.settings.agent.collaboration.reviewerProfileId);
        if (!target) return null;
        const context = await this.buildReviewContext(changedFiles);
        const prompt = [
          "Review the following coding task changes for correctness, regressions, safety, and missing tests.",
          "Do not rewrite the whole project. Be specific and concise.",
          'Your first line must be exactly "VERDICT: APPROVE" or "VERDICT: ISSUES".',
          "If you choose ISSUES, follow with a short bullet list of actionable problems.",
          "",
          `Task request:
${task.userRequest}`,
          "",
          `Implementer summary:
${summary.slice(0, 4e3)}`,
          "",
          `Changed files:
${changedFiles.join("\n") || "(none reported)"}`,
          "",
          context
        ].join("\n");
        try {
          const result = await this.call(
            target.profile,
            target.model,
            [
              {
                role: "system",
                content: "You are a rigorous code reviewer. Do not invent files or test results. Judge only the supplied diff/context."
              },
              { role: "user", content: prompt }
            ],
            3e3
          );
          this.recordUsage(
            task.id,
            target.profile,
            target.model,
            result.usage ?? parseUsageFromText(result.text)
          );
          this.store.recordRoutingEvent({
            taskId: task.id,
            toProfileId: target.profile.id,
            toModelId: target.model.modelId,
            reason: "Reviewer collaboration pass",
            category: "collaboration"
          });
          const verdict = /VERDICT:\s*ISSUES/i.test(result.text) ? "issues" : /VERDICT:\s*APPROVE/i.test(result.text) ? "approve" : "unknown";
          return {
            text: result.text,
            profileId: target.profile.id,
            modelId: target.model.modelId,
            verdict
          };
        } catch (error) {
          const classified = classifyThrown(error, target.profile.providerId);
          this.recordFailure(target.profile, target.model, classified.category, classified.message);
          this.hooks.onNotice?.(
            `Reviewer pass unavailable (${classified.category}): ${classified.message}`
          );
          return null;
        }
      }
      /**
       * Tester pass: a separate model reviews the change for test gaps and
       * verifies claims against the actual diff. Returns feedback text, or null
       * when no tester profile is configured or the pass fails.
       */
      async test(task, changedFiles, summary) {
        const target = this.resolveProfileModel(this.settings.agent.collaboration.testerProfileId);
        if (!target) return null;
        const context = await this.buildReviewContext(changedFiles);
        const prompt = [
          "Act as the tester for this coding task. Review the diff and answer:",
          "1. Which behaviors changed and are they covered by tests?",
          "2. What edge cases or regressions are untested?",
          "3. Did the implementer claim verification it cannot have performed?",
          'Be specific and concise. First line must be "VERDICT: OK" or "VERDICT: GAPS".',
          "",
          `Task request:
${task.userRequest}`,
          "",
          `Implementer summary:
${summary.slice(0, 4e3)}`,
          "",
          `Changed files:
${changedFiles.join("\n") || "(none reported)"}`,
          "",
          context
        ].join("\n");
        try {
          const result = await this.call(
            target.profile,
            target.model,
            [
              {
                role: "system",
                content: "You are a senior test engineer. Judge only the supplied diff/context; never invent test results."
              },
              { role: "user", content: prompt }
            ],
            2e3
          );
          this.recordUsage(
            task.id,
            target.profile,
            target.model,
            result.usage ?? parseUsageFromText(result.text)
          );
          this.store.recordRoutingEvent({
            taskId: task.id,
            toProfileId: target.profile.id,
            toModelId: target.model.modelId,
            reason: "Tester collaboration pass",
            category: "collaboration"
          });
          return { text: result.text, profileId: target.profile.id, modelId: target.model.modelId };
        } catch (error) {
          const classified = classifyThrown(error, target.profile.providerId);
          this.recordFailure(target.profile, target.model, classified.category, classified.message);
          this.hooks.onNotice?.(
            `Tester pass unavailable (${classified.category}): ${classified.message}`
          );
          return null;
        }
      }
      recordFailure(profile, model, category, message) {
        this.store.recordHealth({
          profileId: profile.id,
          ok: false,
          category,
          message
        });
        if (category === "rate_limit" || category === "daily_quota" || category === "provider_outage" || category === "network" || category === "billing_restriction") {
          this.store.saveLimit({
            profileId: profile.id,
            modelId: category === "rate_limit" || category === "network" ? model.modelId : "*",
            category,
            message
          });
        }
      }
      async call(profile, model, messages, maxOutputTokens) {
        const context = await createProfileContext(profile);
        const adapter = createAdapter(profile);
        const response = await adapter.chat(context, {
          model: model.modelId,
          messages,
          tools: [],
          temperature: 0.2,
          maxOutputTokens
        });
        this.store.recordProfileSuccess(profile.id);
        this.store.clearLimit(profile.id, model.modelId);
        return { text: response.content, usage: response.usage };
      }
      async buildReviewContext(changedFiles) {
        const diff = await runProcess(
          "git",
          [
            "diff",
            "--no-color",
            "--",
            ".",
            ":(exclude).env",
            ":(exclude).env.*",
            ":(exclude)*.pem",
            ":(exclude)*.key",
            ":(exclude)*credentials*"
          ],
          { cwd: this.inspector.root, timeoutMs: 15e3, maxOutputBytes: 8e4 }
        );
        const status = await runProcess("git", ["status", "--porcelain=v1"], {
          cwd: this.inspector.root,
          timeoutMs: 1e4,
          maxOutputBytes: 1e4
        });
        const parts = [];
        if (diff.code === 0 && diff.stdout.trim()) {
          parts.push(`Git diff (tracked changes):
${diff.stdout.slice(0, 25e3)}`);
        }
        if (status.code === 0 && status.stdout.trim()) {
          parts.push(`Working tree status:
${status.stdout.slice(0, 4e3)}`);
        }
        let budget = 2e4;
        for (const file of changedFiles.slice(0, 8)) {
          if (isSecretFile(file) || budget <= 0) continue;
          try {
            const absolute = join10(this.inspector.root, file);
            if (statSync8(absolute).size > 6e4) continue;
            const content = readFileSync8(absolute, "utf8");
            const clipped = content.slice(0, Math.min(budget, 6e3));
            parts.push(`--- ${file} (current content excerpt) ---
${clipped}`);
            budget -= clipped.length;
          } catch {
          }
        }
        return parts.join("\n\n") || "No diff available.";
      }
    };
  }
});

// src/core/agent/compaction.ts
function oneLine(text, max) {
  const clean = redactSecrets(text.replace(/\s+/g, " ").trim());
  return clean.length > max ? `${clean.slice(0, max - 1)}\u2026` : clean;
}
function toolArguments(message) {
  const calls = message.toolCalls ?? [];
  if (!calls.length) return "";
  return calls.map((call) => {
    const raw = oneLine(JSON.stringify(call.arguments ?? {}), 180);
    return `${call.name}(${raw})`;
  }).join(", ");
}
function buildWorkLog(stored) {
  const lines = [];
  const earlyUser = stored.filter((message) => message.role === "user").slice(0, 3);
  const seen = /* @__PURE__ */ new Set();
  for (const message of earlyUser) {
    if (message.content.startsWith("[ComiCode resume context]")) continue;
    lines.push(`User: ${oneLine(message.content, 360)}`);
    seen.add(message.id);
  }
  for (const message of stored.slice(-160)) {
    if (message.role === "user") {
      if (message.id !== void 0 && seen.has(message.id)) continue;
      if (message.content.startsWith("[ComiCode resume context]")) continue;
      lines.push(`User: ${oneLine(message.content, 360)}`);
    } else if (message.role === "assistant") {
      const text = oneLine(message.content, 280);
      const tools = toolArguments(message);
      if (text) lines.push(`Assistant: ${text}`);
      if (tools) lines.push(`  tools: ${tools}`);
    } else if (message.role === "tool") {
      const firstLine = message.content.split(/\r?\n/).find((line) => line.trim()) ?? message.content;
      lines.push(
        `Tool ${message.name ?? "tool"}${message.isError ? " (error)" : ""}: ${oneLine(firstLine, 260)}`
      );
    } else if (message.role === "system") {
      if (message.content.startsWith("[Reviewer")) {
        lines.push(`Reviewer: ${oneLine(message.content, 320)}`);
      } else if (message.content.startsWith("[ComiCode paused]")) {
        lines.push(`Pause: ${oneLine(message.content, 320)}`);
      }
    }
  }
  return lines;
}
function buildCompactionSummary(task, stored) {
  const parts = [];
  parts.push("ComiCode context summary");
  parts.push(`Generated: ${(/* @__PURE__ */ new Date()).toISOString()}`);
  parts.push(`Task: ${task.id}`);
  parts.push(`Project: ${task.projectName} (${task.projectPath})`);
  parts.push(`Status: ${task.status} | Phase: ${task.phase}`);
  parts.push("");
  parts.push("Original request:");
  parts.push(oneLine(task.userRequest, 2e3));
  if (task.plan) {
    parts.push("");
    parts.push(`Plan: ${task.plan.summary}`);
    for (const step of task.plan.steps) {
      parts.push(`- [${step.status}] ${step.title}`);
    }
  }
  if (task.completedSteps.length) {
    parts.push("");
    parts.push("Completed steps:");
    for (const step of task.completedSteps.slice(0, 40)) parts.push(`- ${oneLine(step, 240)}`);
  }
  if (task.pendingSteps.length) {
    parts.push("");
    parts.push("Pending steps:");
    for (const step of task.pendingSteps.slice(0, 40)) parts.push(`- ${oneLine(step, 240)}`);
  }
  const files = [.../* @__PURE__ */ new Set([...task.changedFiles, ...task.relevantFiles])];
  if (files.length) {
    parts.push("");
    parts.push(
      `Changed files: ${task.changedFiles.length ? task.changedFiles.join(", ") : "none yet"}`
    );
    if (task.relevantFiles.length) {
      parts.push(`Relevant files: ${task.relevantFiles.slice(0, 40).join(", ")}`);
    }
  }
  parts.push("");
  parts.push("Work log:");
  const workLog = buildWorkLog(stored);
  parts.push(...workLog);
  const lastAssistant = [...stored].reverse().find((message) => message.role === "assistant" && message.content.trim());
  if (lastAssistant) {
    parts.push("");
    parts.push("Last assistant message:");
    parts.push(oneLine(lastAssistant.content, 1500));
  }
  if (task.error) {
    parts.push("");
    parts.push(`Last pause/error: ${oneLine(task.error, 1e3)}`);
  }
  if (task.summary) {
    parts.push("");
    parts.push("Previous final summary:");
    parts.push(oneLine(task.summary, 1500));
  }
  const text = redactSecrets(parts.join("\n"));
  return text.length > 14e3 ? `${text.slice(0, 14e3)}
\u2026 summary truncated` : text;
}
function compactTask(store, taskId) {
  const task = store.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const stored = store.loadStoredMessages(taskId, 1e4);
  if (stored.length === 0) {
    throw new Error("There is no conversation to compact yet.");
  }
  const cutoffSeq = stored[stored.length - 1]?.seq ?? 0;
  const summary = buildCompactionSummary(task, stored);
  const record = {
    summary,
    at: (/* @__PURE__ */ new Date()).toISOString(),
    cutoffSeq,
    messagesCompacted: stored.length,
    files: [...task.changedFiles],
    plan: task.plan
  };
  const metadata = { ...task.metadata, compaction: record };
  const updated = store.updateTask(taskId, { metadata });
  const messages = store.loadMessages(taskId, 400);
  const recentToolOutputs = messages.filter(
    (message) => message.role === "tool"
  ).slice(-8).map((message) => ({
    name: message.name,
    content: message.content.slice(0, 1200),
    at: (/* @__PURE__ */ new Date()).toISOString()
  }));
  store.createCheckpoint(taskId, {
    task: updated,
    messages,
    summary,
    contextCache: {},
    recentToolOutputs,
    savedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  return {
    record,
    task: updated,
    preview: {
      request: task.userRequest,
      status: task.status,
      phase: task.phase,
      model: task.currentModelId,
      plan: task.plan,
      files: [...task.changedFiles],
      messagesCompacted: stored.length
    }
  };
}
function compactionOf(task) {
  const value = task.metadata.compaction;
  if (!value || typeof value !== "object") return null;
  const record = value;
  if (typeof record.summary !== "string" || typeof record.cutoffSeq !== "number") return null;
  return record;
}
var init_compaction = __esm({
  "src/core/agent/compaction.ts"() {
    "use strict";
    init_redact();
  }
});

// src/core/git/repository.ts
var repository_exports = {};
__export(repository_exports, {
  captureGitBaseline: () => captureGitBaseline,
  formatGitStatus: () => formatGitStatus,
  gitBranch: () => gitBranch,
  gitDiffForFiles: () => gitDiffForFiles,
  gitSummary: () => gitSummary,
  hashFile: () => hashFile,
  hashFiles: () => hashFiles,
  isGitRepository: () => isGitRepository,
  performUndo: () => performUndo,
  planUndo: () => planUndo,
  recordGitFinalMetadata: () => recordGitFinalMetadata,
  runGit: () => runGit
});
import { execFile } from "child_process";
import { createHash as createHash4 } from "crypto";
import { readFileSync as readFileSync9, unlinkSync as unlinkSync3 } from "fs";
import { isAbsolute, join as join11, relative as relative3, resolve as resolve3, sep as sep3 } from "path";
function runGit(root, args, options = {}) {
  return new Promise((resolveResult) => {
    execFile(
      "git",
      args,
      {
        cwd: root,
        windowsHide: true,
        timeout: options.timeoutMs ?? 15e3,
        maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
        encoding: "utf8"
      },
      (error, stdout3, stderr) => {
        const code = error && typeof error.code === "number" ? error.code ?? null : error ? null : 0;
        resolveResult({
          ok: !error,
          stdout: String(stdout3 ?? ""),
          stderr: String(stderr ?? ""),
          code
        });
      }
    );
  });
}
function classifyCode(code) {
  if (code === "??" || code === "? ") return "untracked";
  if (code.includes("U") || code === "AA" || code === "DD") return "conflicted";
  const worktree = code[1] ?? " ";
  const index = code[0] ?? " ";
  const chosen = worktree !== " " && worktree !== "?" ? worktree : index;
  switch (chosen) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "M":
    case "T":
      return "modified";
    default:
      return "unknown";
  }
}
async function isGitRepository(root) {
  const result = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  return result.ok && result.stdout.trim() === "true";
}
async function gitSummary(root) {
  const inside = await isGitRepository(root);
  if (!inside) {
    return {
      repository: false,
      branch: null,
      detached: false,
      files: [],
      clean: true,
      ahead: 0,
      behind: 0
    };
  }
  const branchResult = await runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  let branch = branchResult.ok ? branchResult.stdout.trim() : null;
  let detached = false;
  if (branch === "HEAD") {
    detached = true;
    const sha = await runGit(root, ["rev-parse", "--short", "HEAD"]);
    branch = sha.ok ? `detached@${sha.stdout.trim()}` : "detached";
  }
  if (!branch) branch = "unborn";
  const statusResult = await runGit(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all"
  ]);
  const files = [];
  if (statusResult.ok) {
    const records = statusResult.stdout.split("\0");
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record || record.length < 3) continue;
      const code = record.slice(0, 2);
      const path = record.slice(3);
      let originalPath;
      if (code[0] === "R" || code[0] === "C") {
        const next = records[index + 1];
        if (next) {
          originalPath = next;
          index += 1;
        }
      }
      files.push({
        path,
        ...originalPath ? { originalPath } : {},
        status: classifyCode(code),
        code,
        staged: code[0] !== " " && code[0] !== "?"
      });
    }
  }
  let ahead = 0;
  let behind = 0;
  const upstream = await runGit(root, [
    "rev-list",
    "--left-right",
    "--count",
    "HEAD...@{upstream}"
  ]);
  if (upstream.ok) {
    const [left, right] = upstream.stdout.trim().split(/\s+/);
    ahead = Number(left ?? 0) || 0;
    behind = Number(right ?? 0) || 0;
  }
  return {
    repository: true,
    branch,
    detached,
    files,
    clean: files.length === 0,
    ahead,
    behind,
    ...statusResult.ok ? {} : { error: statusResult.stderr.trim() || "git status failed" }
  };
}
async function gitBranch(root) {
  const summary = await gitSummary(root);
  return summary.repository ? summary.branch : null;
}
async function pathExistsInRevision(root, revision, path) {
  const result = await runGit(root, ["cat-file", "-e", `${revision}:${path}`]);
  return result.ok;
}
function safeRelative(root, path) {
  if (!path || isAbsolute(path)) return null;
  const absolute = resolve3(root, path);
  const rel = relative3(root, absolute);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.split(sep3).includes(".git"))
    return null;
  return rel;
}
function hashFile(root, path) {
  const safe = safeRelative(root, path);
  if (!safe) return null;
  try {
    return createHash4("sha256").update(readFileSync9(join11(root, safe))).digest("hex");
  } catch {
    return null;
  }
}
function hashFiles(root, files) {
  const hashes = {};
  for (const path of files) {
    const safe = safeRelative(root, path);
    if (safe) hashes[safe] = hashFile(root, safe);
  }
  return hashes;
}
async function captureGitBaseline(root, taskId) {
  if (!await isGitRepository(root)) return null;
  const headResult = await runGit(root, ["rev-parse", "HEAD"]);
  const head = headResult.ok ? headResult.stdout.trim() || null : null;
  const snapshotResult = await runGit(root, ["stash", "create", `comicode-baseline-${taskId}`]);
  const snapshot = snapshotResult.ok ? snapshotResult.stdout.trim() || null : null;
  let snapshotRef = null;
  if (snapshot) {
    const ref = `refs/comicode/baseline/${taskId.replace(/[^A-Za-z0-9._-]/g, "-")}`;
    const update = await runGit(root, ["update-ref", ref, snapshot]);
    if (update.ok) snapshotRef = ref;
  }
  const status = await gitSummary(root);
  const untracked = status.files.filter((file) => file.status === "untracked" || file.code === "??").map((file) => file.path);
  return {
    head,
    snapshot,
    snapshotRef,
    untracked,
    at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function recordGitFinalMetadata(root, task) {
  const baseline = task.metadata.gitBaseline;
  if (!baseline) return null;
  const changedFiles = [...new Set(task.changedFiles)].filter((path) => safeRelative(root, path));
  const final = {
    hashes: hashFiles(root, changedFiles),
    changedFiles,
    at: (/* @__PURE__ */ new Date()).toISOString()
  };
  return {
    ...task.metadata,
    gitBaseline: baseline,
    gitFinal: final
  };
}
function untrackedDiff(root, path) {
  const safe = safeRelative(root, path);
  if (!safe) return "";
  try {
    const buffer = readFileSync9(join11(root, safe));
    if (buffer.length > 24e4)
      return `--- /dev/null
+++ b/${safe}
[binary or large file omitted]
`;
    const text = buffer.toString("utf8");
    if (text.includes("\0")) {
      return `--- /dev/null
+++ b/${safe}
[binary file omitted]
`;
    }
    const lines = text.split(/\r?\n/);
    return [
      "--- /dev/null",
      `+++ b/${safe}`,
      `@@ untracked file (${lines.length} lines) @@`,
      ...lines.map((line) => `+${line}`)
    ].join("\n");
  } catch {
    return "";
  }
}
async function gitDiffForFiles(root, files, options = {}) {
  const summary = await gitSummary(root);
  if (!summary.repository) return "";
  const paths = files.length ? files.filter((path) => safeRelative(root, path)) : [];
  const trackedArgs = ["diff", "--no-color", "--no-ext-diff", "HEAD"];
  if (paths.length) trackedArgs.push("--", ...paths);
  const tracked = await runGit(root, trackedArgs);
  const pieces = [];
  if (tracked.ok && tracked.stdout.trim()) pieces.push(tracked.stdout.trimEnd());
  if (!tracked.ok) {
    const unstaged = await runGit(root, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      ...paths.length ? ["--", ...paths] : []
    ]);
    const staged = await runGit(root, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--cached",
      ...paths.length ? ["--", ...paths] : []
    ]);
    if (unstaged.ok && unstaged.stdout.trim()) pieces.push(unstaged.stdout.trimEnd());
    if (staged.ok && staged.stdout.trim()) pieces.push(staged.stdout.trimEnd());
  }
  const wanted = new Set(paths.length ? paths : summary.files.map((file) => file.path));
  for (const file of summary.files) {
    if (!wanted.has(file.path)) continue;
    if (file.status !== "untracked" && file.code !== "??") continue;
    const diff = untrackedDiff(root, file.path);
    if (diff) pieces.push(diff);
  }
  const combined = pieces.join("\n\n");
  const maxChars = options.maxChars ?? 8e4;
  return combined.length > maxChars ? `${combined.slice(0, maxChars)}

\u2026 diff truncated (${combined.length - maxChars} characters omitted)` : combined;
}
async function planUndo(root, task) {
  const baseline = task.metadata.gitBaseline;
  const final = task.metadata.gitFinal;
  if (!baseline) {
    return {
      supported: false,
      reason: "This task has no git baseline snapshot. Undo would risk touching unrelated files, so it is unavailable.",
      items: [],
      skipped: [],
      restoreCount: 0,
      deleteCount: 0
    };
  }
  if (!await isGitRepository(root)) {
    return {
      supported: false,
      reason: "The project is not a git repository. Safe undo requires git.",
      items: [],
      skipped: [],
      restoreCount: 0,
      deleteCount: 0
    };
  }
  const summary = await gitSummary(root);
  if (!summary.repository) {
    return {
      supported: false,
      reason: "Git is unavailable in this project.",
      items: [],
      skipped: [],
      restoreCount: 0,
      deleteCount: 0
    };
  }
  const changed = [.../* @__PURE__ */ new Set([...final?.changedFiles ?? [], ...task.changedFiles])];
  const items = [];
  const skipped = [];
  const untrackedBefore = new Set(baseline.untracked);
  for (const rawPath of changed) {
    const path = safeRelative(root, rawPath);
    if (!path) {
      skipped.push({ path: rawPath, reason: "Path is outside the project or protected." });
      continue;
    }
    const expected = final?.hashes[path];
    if (expected === void 0) {
      skipped.push({ path, reason: "No post-task content hash was recorded." });
      continue;
    }
    const current = hashFile(root, path);
    if (current !== expected) {
      skipped.push({
        path,
        reason: "The file changed after ComiCode finished. It may contain your own work."
      });
      continue;
    }
    if (untrackedBefore.has(path)) {
      skipped.push({
        path,
        reason: "The file was untracked before this task; restoring it could discard your work."
      });
      continue;
    }
    let action = "delete";
    let source = null;
    if (baseline.snapshotRef && await pathExistsInRevision(root, baseline.snapshotRef, path)) {
      action = "restore";
      source = baseline.snapshotRef;
    } else if (baseline.head && await pathExistsInRevision(root, baseline.head, path)) {
      action = "restore";
      source = baseline.head;
    }
    items.push({
      path,
      action,
      source,
      reason: action === "restore" ? `Restore from ${source === baseline.head ? "the task baseline commit" : "the task baseline snapshot"}.` : "Delete a file created by this task."
    });
  }
  return {
    supported: items.length > 0,
    reason: items.length > 0 ? null : "No files can be safely restored. Every changed file was modified after the task, was untracked before it, or has no recorded hash.",
    items,
    skipped,
    restoreCount: items.filter((item) => item.action === "restore").length,
    deleteCount: items.filter((item) => item.action === "delete").length
  };
}
async function performUndo(root, plan) {
  const restored = [];
  const deleted = [];
  const failed = [];
  for (const item of plan.items) {
    if (item.action === "restore" && item.source) {
      const result = await runGit(root, [
        "restore",
        `--source=${item.source}`,
        "--worktree",
        "--",
        item.path
      ]);
      if (result.ok) restored.push(item.path);
      else failed.push({ path: item.path, message: result.stderr.trim() || "git restore failed" });
      continue;
    }
    try {
      const absolute = join11(root, item.path);
      unlinkSync3(absolute);
      deleted.push(item.path);
    } catch (error) {
      const code = error.code;
      if (code === "ENOENT") deleted.push(item.path);
      else
        failed.push({
          path: item.path,
          message: error instanceof Error ? error.message : String(error)
        });
    }
  }
  return { ok: failed.length === 0, restored, deleted, failed };
}
function formatGitStatus(change) {
  switch (change.status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "untracked":
      return "?";
    case "conflicted":
      return "U";
    default:
      return "M";
  }
}
var init_repository = __esm({
  "src/core/git/repository.ts"() {
    "use strict";
  }
});

// src/core/agent/agent.ts
function effortProfileFor(store, currentProfileId) {
  const profileId = currentProfileId ?? store.getSelectedProfileId();
  if (!profileId) return null;
  const effort = store.getProfile(profileId)?.config?.effort;
  if (typeof effort !== "string" || effort === "default") return null;
  return EFFORT_PROFILES[effort] ?? null;
}
function sleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve6) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve6();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve6();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function mergeUnique(base, additions) {
  const set = new Set(base);
  for (const item of additions) if (item) set.add(item);
  return [...set];
}
var DEFAULT_AUTHORITY, EFFORT_PROFILES, CodingAgent;
var init_agent = __esm({
  "src/core/agent/agent.ts"() {
    "use strict";
    init_skills();
    init_modes();
    init_inspector();
    init_router();
    init_engine();
    init_executor();
    init_context();
    init_collaboration();
    init_service();
    init_registry();
    init_errors();
    init_redact();
    init_logger();
    init_compaction();
    init_repository();
    DEFAULT_AUTHORITY = {
      allowFileWrites: false,
      allowCommands: false,
      allowDangerousCommands: false,
      allowSecrets: false,
      allowGitWrite: false
    };
    EFFORT_PROFILES = {
      low: {
        maxSteps: 10,
        contextBudgetRatio: 0.35,
        maxToolOutputChars: 5e3,
        historyLimit: 120,
        maxOutputTokens: 2048,
        tokenHint: "Token discipline: minimum possible response. Answer in the fewest words that fully satisfy the request. No preamble, no recap, no explanations unless asked. Still use tools when needed."
      },
      medium: {
        maxSteps: 20,
        contextBudgetRatio: 0.45,
        maxToolOutputChars: 8e3,
        historyLimit: 200,
        maxOutputTokens: 3072,
        tokenHint: "Token discipline: be concise. Skip preamble and unnecessary explanation; get to the result."
      },
      high: {
        maxSteps: 50,
        contextBudgetRatio: 0.6,
        maxToolOutputChars: 14e3,
        historyLimit: 350,
        maxOutputTokens: 6144,
        tokenHint: null
      },
      xhigh: {
        maxSteps: 80,
        contextBudgetRatio: 0.75,
        maxToolOutputChars: 2e4,
        historyLimit: 500,
        maxOutputTokens: 12288,
        tokenHint: null
      }
    };
    CodingAgent = class {
      store;
      task;
      hooks;
      authority;
      settings;
      inspector;
      router;
      executor;
      collaborator;
      builder = new ContextBuilder();
      adapterFactory;
      contextFactory;
      contextCache = {};
      contextSummary = "";
      compactionCutoff = 0;
      relevantFiles = [];
      projectSummary = "";
      candidate = null;
      exclude = /* @__PURE__ */ new Set();
      retryCounts = /* @__PURE__ */ new Map();
      consecutiveFailures = 0;
      excludedProfiles = /* @__PURE__ */ new Set();
      profileFailures = /* @__PURE__ */ new Map();
      switchConsent = /* @__PURE__ */ new Set();
      baselineProviderId = null;
      hadFailure = false;
      lastFailureInfo = null;
      keyCursor = /* @__PURE__ */ new Map();
      keyCounts = /* @__PURE__ */ new Map();
      contextSlim = false;
      completionSummary = null;
      finalResponse = null;
      reviewCycles = 0;
      testerCycles = 0;
      verificationRan = false;
      verificationNudged = false;
      lastBlocked = [];
      usage = { inputTokens: 0, outputTokens: 0 };
      steps = 0;
      mode;
      skills;
      effort;
      constructor(options) {
        this.store = options.store;
        const task = options.store.getTask(options.taskId);
        if (!task) throw new Error(`Task not found: ${options.taskId}`);
        this.task = task;
        this.hooks = options.hooks ?? {};
        this.authority = options.authority ?? DEFAULT_AUTHORITY;
        this.applySavedModelSelection();
        const baseSettings = options.settings ?? options.store.getSettings();
        this.effort = effortProfileFor(options.store, task.currentProfileId);
        this.settings = this.effort ? {
          ...baseSettings,
          agent: {
            ...baseSettings.agent,
            maxSteps: this.effort.maxSteps,
            contextBudgetRatio: this.effort.contextBudgetRatio,
            maxToolOutputChars: this.effort.maxToolOutputChars
          }
        } : baseSettings;
        this.inspector = new ProjectInspector(task.projectPath, {
          get: async (path) => {
            const row = options.store.getProjectSnapshot(path);
            if (!row) return null;
            return { snapshot: row.snapshot, updatedAt: row.updatedAt };
          },
          set: (path, snapshot) => options.store.saveProjectSnapshot(path, snapshot)
        });
        this.router = new Router(options.store, options.routingOverrides);
        this.adapterFactory = options.adapterFactory ?? ((profile) => createAdapter(profile));
        this.contextFactory = options.contextFactory ?? ((profile, keyIndex) => createProfileContext(profile, keyIndex));
        const requestedMode = options.mode ?? "build";
        this.mode = requestedMode === "auto" ? classifyAgentMode(task.summary ?? "") : requestedMode;
        if (requestedMode === "auto" && this.mode !== "auto") {
          this.hooks.onNotice?.(`Auto mode selected ${this.mode} for this task.`);
        }
        this.skills = loadSkills(task.projectPath);
        this.executor = new ToolExecutor({
          root: task.projectPath,
          settings: this.settings,
          authority: this.authority,
          inspector: this.inspector,
          confirm: this.hooks.confirm,
          mode: this.mode,
          skills: this.skills,
          getSettings: () => this.store.getSettings(),
          onGrant: (request) => this.persistGrant(request),
          onPlan: (plan) => this.applyPlan(plan),
          onTaskComplete: (summary) => {
            this.completionSummary = summary;
          },
          onNotice: (message) => this.hooks.onNotice?.(message)
        });
        this.collaborator = new Collaborator(options.store, this.inspector, this.settings, this.hooks);
      }
      /**
       * Apply a model the user selected after this task last ran. The selection
       * timestamp is stored with the task, so a fallback performed *inside* a run
       * is not undone on the next turn — only a newer explicit pick overrides it.
       */
      applySavedModelSelection() {
        const savedDbId = this.store.getSelectedModelId();
        const savedAt = this.store.getSelectedModelChangedAt();
        if (!savedDbId || !savedAt) return;
        const appliedAt = typeof this.task.metadata.modelSelectionAt === "string" ? this.task.metadata.modelSelectionAt : "";
        if (appliedAt && savedAt <= appliedAt) return;
        const saved = this.store.getModelById(savedDbId);
        if (!saved) {
          this.hooks.onNotice?.(
            "Your selected model is no longer in the catalog \u2014 keeping the current route."
          );
          return;
        }
        const profile = (saved.profileId ? this.store.getProfile(saved.profileId) : null) ?? (this.store.getSelectedProfileId() ? this.store.getProfile(this.store.getSelectedProfileId()) : null) ?? this.store.listProfiles(saved.providerId).find((entry) => entry.enabled) ?? null;
        const current = this.task.currentProfileId ? this.store.getProfile(this.task.currentProfileId) : null;
        const targetProfile = profile && profile.providerId === saved.providerId ? profile : current && current.providerId === saved.providerId ? current : null;
        if (!targetProfile) {
          this.hooks.onNotice?.(
            `Your selected model ${saved.modelId} has no enabled provider profile \u2014 keeping the current route.`
          );
          return;
        }
        const changed = this.task.currentProfileId !== targetProfile.id || this.task.currentModelId !== saved.modelId;
        this.task = this.store.updateTask(this.task.id, {
          currentProfileId: targetProfile.id,
          currentModelId: saved.modelId,
          metadata: { ...this.task.metadata, modelSelectionAt: savedAt }
        });
        if (changed) {
          this.candidate = null;
          this.exclude.delete(candidateKey(targetProfile.id, saved.modelId));
          this.hooks.onNotice?.(
            `Trying your selected model first: ${targetProfile.name} \xB7 ${saved.modelId}.`
          );
        }
      }
      async run(options = {}) {
        const maxSteps2 = Math.max(1, Math.min(options.maxSteps ?? this.settings.agent.maxSteps, 200));
        try {
          await this.prepare(options);
          if (options.signal?.aborted) return this.halt("paused", "Cancelled by user. Progress saved.");
          await this.runPlannerIfEnabled();
          this.setPhase("inspect");
          this.checkpoint("run-start");
          let emptyResponses = 0;
          while (this.steps < maxSteps2) {
            if (options.signal?.aborted) {
              return this.halt("paused", "Cancelled by user. Progress saved.");
            }
            const candidate = await this.ensureCandidate();
            if (!candidate) {
              return this.halt("paused", this.buildPauseReason());
            }
            const built = this.buildContext(candidate);
            this.steps += 1;
            let response;
            try {
              response = await this.callModel(candidate, built, options.signal);
              this.consecutiveFailures = 0;
              this.hadFailure = false;
              this.profileFailures.clear();
            } catch (error) {
              const outcome = await this.handleFailure(error, candidate, options.signal);
              if (outcome === "cancel") {
                return this.halt("paused", "Cancelled by user. Progress saved.");
              }
              if (outcome === "stop") {
                return this.halt(
                  "paused",
                  "Stopped after repeated consecutive provider failures. Progress and checkpoints are saved \u2014 check provider quota, then resume."
                );
              }
              this.checkpoint("after-failure");
              continue;
            }
            const usage2 = this.recordTurnUsage(candidate, built, response);
            this.hooks.onUsage?.(usage2, candidate, response.usage === null);
            const assistantMessage = {
              role: "assistant",
              content: response.content,
              ...response.toolCalls.length ? { toolCalls: response.toolCalls } : {}
            };
            this.store.appendMessage(this.task.id, assistantMessage);
            this.hooks.onAssistantMessage?.(response.content);
            if (response.toolCalls.length > 0) {
              emptyResponses = 0;
              this.checkpoint("assistant-message");
              const completed = await this.executeTools(response.toolCalls, options.signal);
              this.checkpoint("after-tools");
              if (options.signal?.aborted) {
                return this.halt("paused", "Cancelled by user. Progress saved.");
              }
              if (completed || this.completionSummary) {
                if (this.shouldRequestVerification()) {
                  this.verificationNudged = true;
                  this.completionSummary = null;
                  this.finalResponse = null;
                  this.store.appendMessage(this.task.id, {
                    role: "user",
                    content: "[ComiCode verification] Before completing, run the configured checks with run_tests, run_lint, or run_build and fix any failures you introduced. For UI changes, also run the configured uiVerifyCommand via run_command if set. If verification is impossible, say why in task_complete."
                  });
                  this.checkpoint("verification-nudge");
                  continue;
                }
                const continueAfterTest = await this.testIfEnabled();
                if (continueAfterTest) {
                  this.completionSummary = null;
                  this.finalResponse = null;
                  this.setPhase("test");
                  this.checkpoint("after-test");
                  continue;
                }
                const continueAfterReview2 = await this.reviewIfEnabled();
                if (continueAfterReview2) {
                  this.completionSummary = null;
                  this.finalResponse = null;
                  this.setPhase("implement");
                  this.checkpoint("after-review");
                  continue;
                }
                return this.complete();
              }
              continue;
            }
            if (!response.content.trim()) {
              emptyResponses += 1;
              if (emptyResponses <= 2 && response.finishReason !== "content_filter") {
                this.store.appendMessage(this.task.id, {
                  role: "user",
                  content: "Your previous response was empty. Continue the task with a tool call, or call task_complete with a summary if the work is finished."
                });
                this.checkpoint("empty-response-nudge");
                continue;
              }
              return this.halt(
                "paused",
                "The model returned empty responses repeatedly. Progress is saved; resume with a different model or provider."
              );
            }
            emptyResponses = 0;
            this.finalResponse = response.content;
            this.completionSummary = this.completionSummary ?? response.content.slice(0, 8e3);
            const continueAfterReview = await this.reviewIfEnabled();
            if (continueAfterReview) {
              this.completionSummary = null;
              this.finalResponse = null;
              this.setPhase("implement");
              this.checkpoint("after-review");
              continue;
            }
            return this.complete();
          }
          return this.halt(
            "paused",
            `Reached the maximum of ${maxSteps2} agent steps. Progress and checkpoints are saved. Resume with "comicode resume ${this.task.id}" or raise agent.maxSteps.`
          );
        } catch (error) {
          logger.error(
            `Agent failure: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
          );
          const message = redactSecrets(error instanceof Error ? error.message : String(error));
          return this.halt("failed", `Agent stopped with an unexpected error: ${message}`);
        }
      }
      // ------------------------------------------------------------------ prepare
      async prepare(options) {
        if (!this.task.projectPath) throw new Error("Task has no project path.");
        this.settings = this.store.getSettings();
        this.store.clearExpiredLimits();
        const compaction = compactionOf(this.task);
        if (compaction) {
          this.compactionCutoff = compaction.cutoffSeq;
          this.contextSummary = compaction.summary;
        }
        if (this.task.metadata.gitBaseline === void 0 && (!options.resume || this.task.changedFiles.length === 0)) {
          try {
            const baseline = await captureGitBaseline(this.task.projectPath, this.task.id);
            if (baseline) {
              this.task = this.store.updateTask(this.task.id, {
                metadata: { ...this.task.metadata, gitBaseline: baseline }
              });
            }
          } catch (error) {
            logger.warn(`Unable to capture a git baseline for task ${this.task.id}: ${String(error)}`);
          }
        }
        if (options.resume) {
          const checkpoint = this.store.latestCheckpoint(this.task.id);
          if (checkpoint?.state?.contextCache) this.contextCache = checkpoint.state.contextCache;
          if (checkpoint?.state?.summary) this.contextSummary = checkpoint.state.summary;
          const projectState = await this.inspector.resumeState(this.task.changedFiles);
          const resume = this.store.buildResumeSummary(this.task.id, projectState);
          const noteParts = [];
          noteParts.push(
            "This task is being resumed. Do not assume previous edits are still present \u2014 verify the working tree with git_status/read_file before repeating completed work."
          );
          noteParts.push(`Original request:
${this.task.userRequest}`);
          noteParts.push(`Phase when stopped: ${this.task.phase}`);
          if (this.task.completedSteps.length) {
            noteParts.push(
              `Completed steps:
${this.task.completedSteps.map((step) => `- ${step}`).join("\n")}`
            );
          }
          if (this.task.pendingSteps.length) {
            noteParts.push(
              `Pending steps:
${this.task.pendingSteps.map((step) => `- ${step}`).join("\n")}`
            );
          }
          if (this.task.changedFiles.length) {
            noteParts.push(`Previously changed files: ${this.task.changedFiles.join(", ")}`);
          }
          if (resume?.recentTools.length) {
            noteParts.push(`Recent tool output (may be stale):
${resume.recentTools.join("\n")}`);
          }
          noteParts.push(`Current project state:
${projectState}`);
          if (this.contextSummary)
            noteParts.push(`Earlier summary:
${this.contextSummary.slice(0, 3e3)}`);
          this.store.appendMessage(this.task.id, {
            role: "user",
            content: `[ComiCode resume context]
${noteParts.join("\n\n").slice(0, 1e4)}`
          });
          this.exclude.clear();
          this.retryCounts.clear();
          this.consecutiveFailures = 0;
          this.excludedProfiles.clear();
          this.profileFailures.clear();
          this.switchConsent.clear();
          this.baselineProviderId = null;
          this.hadFailure = false;
          this.lastFailureInfo = null;
          this.keyCursor.clear();
          this.keyCounts.clear();
          this.candidate = null;
          this.contextSlim = false;
          this.reviewCycles = 0;
          this.testerCycles = 0;
          this.verificationRan = false;
          this.verificationNudged = false;
          this.completionSummary = null;
          this.finalResponse = null;
          this.usage = { inputTokens: 0, outputTokens: 0 };
          this.task = this.store.updateTask(this.task.id, {
            status: "running",
            phase: "inspect",
            error: null,
            completedAt: null,
            resumeCount: this.task.resumeCount + 1,
            summary: this.task.summary
          });
        } else {
          if (this.task.status === "completed") {
            throw new Error("This task is already completed. Start a new task instead.");
          }
          this.task = this.store.updateTask(this.task.id, {
            status: "running",
            error: null,
            completedAt: null
          });
        }
        this.repairHistory();
        const snapshot = await this.inspector.snapshot();
        this.projectSummary = snapshot.summaryText;
        const relevant = await this.inspector.relevantFiles(this.task.userRequest, {
          changedFiles: this.task.changedFiles,
          extraFiles: this.task.relevantFiles,
          limit: 18
        });
        this.relevantFiles = relevant;
        this.task = this.store.updateTask(this.task.id, {
          relevantFiles: mergeUnique(
            this.task.relevantFiles,
            relevant.map((entry) => entry.path)
          ).slice(0, 60)
        });
      }
      repairHistory() {
        const messages = this.store.loadMessages(this.task.id, 1e3);
        if (!messages.some((message) => message.role === "user")) {
          this.store.appendMessage(this.task.id, { role: "user", content: this.task.userRequest });
          return;
        }
        const lastAssistantIndex = [...messages].map(
          (message, index) => message.role === "assistant" && message.toolCalls?.length ? index : -1
        ).filter((index) => index >= 0).pop();
        if (lastAssistantIndex === void 0) return;
        const assistant = messages[lastAssistantIndex];
        if (!assistant || assistant.role !== "assistant" || !assistant.toolCalls) return;
        const subsequent = messages.slice(lastAssistantIndex + 1);
        if (subsequent.some((message) => message.role === "assistant")) return;
        const answered = new Set(
          subsequent.filter(
            (message) => message.role === "tool"
          ).map((message) => message.toolCallId)
        );
        for (const call of assistant.toolCalls) {
          if (answered.has(call.id)) continue;
          this.store.appendMessage(this.task.id, {
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: "Interrupted before this tool completed. Inspect the project state before retrying.",
            isError: true
          });
        }
      }
      async runPlannerIfEnabled() {
        const collaboration = this.settings.agent.collaboration;
        if (!collaboration.enabled || !collaboration.plannerProfileId) return;
        if (this.task.plan) return;
        this.setPhase("plan");
        const result = await this.collaborator.plan(this.task, this.projectSummary);
        if (!result) return;
        const plan = planFromCollaborator(result.text);
        this.applyPlan(plan);
        this.store.appendMessage(this.task.id, {
          role: "system",
          content: `[Planner ${result.modelId}]
${result.text.slice(0, 6e3)}`
        });
        this.checkpoint("planner");
      }
      /** Persist an "always allow" grant chosen in an approval dialog. */
      persistGrant(request) {
        this.store.updateSettings((settings) => {
          const permissions = settings.agent.permissions;
          const push = (list, value) => {
            if (!value || list.includes(value) || list.length >= 200) return;
            list.push(value);
          };
          if (request.kind === "command" || request.kind === "dangerous-command") {
            push(permissions.allowCommands, request.command);
          } else if (request.path) {
            push(permissions.allowPaths, request.path.replace(/\\/g, "/"));
          }
          return settings;
        });
        this.hooks.onNotice?.(
          `Saved permission: future matching ${request.kind === "command" || request.kind === "dangerous-command" ? "commands" : "paths"} will be allowed automatically.`
        );
      }
      applyPlan(plan) {
        const completed = plan.steps.filter((step) => step.status === "completed" || step.status === "skipped").map((step) => step.title);
        const pending = plan.steps.filter((step) => step.status !== "completed" && step.status !== "skipped").map((step) => step.title);
        this.task = this.store.updateTask(this.task.id, {
          plan,
          completedSteps: completed,
          pendingSteps: pending,
          phase: this.task.phase === "intake" || this.task.phase === "inspect" ? "plan" : this.task.phase
        });
        this.hooks.onPlan?.(plan);
      }
      // ---------------------------------------------------------------- routing
      async ensureCandidate() {
        if (this.candidate) {
          const profile = this.store.getProfile(this.candidate.profile.id);
          const limit = this.store.getLimit(this.candidate.profile.id, this.candidate.model.modelId) ?? this.store.getLimit(this.candidate.profile.id, "*");
          if (profile?.enabled && !limit?.active) return this.candidate;
          this.candidate = null;
        }
        for (; ; ) {
          const result = this.router.select({
            taskId: this.task.id,
            taskType: this.task.taskType,
            profileId: this.task.currentProfileId,
            modelId: this.task.currentModelId,
            excludeKeys: [...this.exclude],
            excludedProfileIds: [...this.excludedProfiles],
            requirements: { tools: true, vision: this.task.taskType === "vision" }
          });
          this.lastBlocked = result.outcome.blocked;
          if (!result.decision) {
            this.candidate = null;
            return null;
          }
          const candidate = result.decision.candidate;
          const needsConsent = this.hadFailure && this.baselineProviderId !== null && candidate.profile.providerId !== this.baselineProviderId && !this.switchConsent.has(candidate.profile.providerId);
          if (needsConsent && this.hooks.confirm) {
            const decision = await this.hooks.confirm({
              kind: "provider-switch",
              title: "Switch provider?",
              description: `${candidate.profile.name} can continue this task. Previous provider hit a limit${this.lastFailureInfo ? `: ${this.lastFailureInfo.slice(0, 80)}` : "."}`,
              path: `${candidate.profile.name} \xB7 ${candidate.model.modelId}`
            });
            if (decision === "deny") {
              for (const profile of this.store.listProfiles()) {
                if (profile.providerId === candidate.profile.providerId) {
                  this.excludedProfiles.add(profile.id);
                }
              }
              this.hooks.onNotice?.(
                `Skipped ${candidate.profile.name} \u2014 continuing with remaining providers.`
              );
              continue;
            }
            this.switchConsent.add(candidate.profile.providerId);
          }
          const previousProfile = this.task.currentProfileId;
          const previousModel = this.task.currentModelId;
          if (previousProfile && previousModel && (previousProfile !== candidate.profile.id || previousModel !== candidate.model.modelId)) {
            this.appendHandoff(previousProfile, previousModel, candidate);
          }
          this.candidate = candidate;
          this.baselineProviderId = candidate.profile.providerId;
          this.router.record(result.decision, {
            taskId: this.task.id,
            previousProfileId: previousProfile,
            previousModelId: previousModel
          });
          this.task = this.store.updateTask(this.task.id, {
            currentProfileId: candidate.profile.id,
            currentModelId: candidate.model.modelId
          });
          this.hooks.onRoute?.(result.decision);
          return candidate;
        }
      }
      /**
       * Persist a compact handoff note when routing continues on a different
       * model/profile. The note lives in conversation history, so the next model
       * knows why it is here and which work is already finished.
       */
      appendHandoff(previousProfileId, previousModelId, next) {
        const previous = this.store.getProfile(previousProfileId);
        const previousLabel = `${previous?.name ?? previousProfileId} \xB7 ${previousModelId}`;
        const reason = this.lastFailureInfo ? ` (${this.lastFailureInfo.slice(0, 200)})` : "";
        const parts = [
          `[Provider handoff] ${previousLabel} stopped${reason}. Continuing with ${next.profile.name} \xB7 ${next.model.modelId}.`,
          "The task, plan, checkpoints, and tool history are preserved. Review the current state and continue from the last completed step. Do not restart work that is already done."
        ];
        if (this.task.completedSteps.length) {
          parts.push(
            `Completed steps:
${this.task.completedSteps.slice(-12).map((step) => `- ${step}`).join("\n")}`
          );
        }
        if (this.task.pendingSteps.length) {
          parts.push(
            `Pending steps:
${this.task.pendingSteps.slice(0, 12).map((step) => `- ${step}`).join("\n")}`
          );
        }
        if (this.task.changedFiles.length) {
          parts.push(`Changed files: ${this.task.changedFiles.slice(0, 30).join(", ")}`);
        }
        this.store.appendMessage(this.task.id, {
          role: "system",
          content: parts.join("\n\n").slice(0, 3500)
        });
        this.hooks.onNotice?.(
          `Handed off ${previousLabel} \u2192 ${next.profile.name} \xB7 ${next.model.modelId}; context preserved.`
        );
      }
      buildContext(candidate) {
        const settings = this.contextSlim ? {
          ...this.settings,
          agent: {
            ...this.settings.agent,
            contextBudgetRatio: Math.min(0.32, this.settings.agent.contextBudgetRatio)
          }
        } : this.settings;
        const historyLimit = this.effort?.historyLimit ?? 200;
        const history2 = this.compactionCutoff > 0 ? this.store.loadMessagesAfter(this.task.id, this.compactionCutoff, historyLimit) : this.store.loadMessages(this.task.id, historyLimit);
        const built = this.builder.build({
          task: this.task,
          model: candidate.model,
          history: history2,
          settings,
          inspector: this.inspector,
          relevantFiles: this.relevantFiles,
          cache: this.contextCache,
          summary: this.contextSummary,
          projectSummary: this.projectSummary,
          skills: this.skills,
          mode: this.mode,
          effortHint: this.effort?.tokenHint ?? void 0
        });
        this.contextCache = built.cache;
        this.contextSummary = built.summary;
        return built;
      }
      // ------------------------------------------------------------------- model
      async callModel(candidate, built, signal) {
        const profileId = candidate.profile.id;
        const keyIndex = this.keyCursor.get(profileId) ?? 0;
        const context = await this.contextFactory(candidate.profile, keyIndex);
        this.keyCounts.set(profileId, context.keyCount ?? 1);
        context.signal = signal;
        const adapter = this.adapterFactory(candidate.profile);
        const outputCap = this.effort?.maxOutputTokens ?? 4096;
        const modelMax = candidate.model.maxOutputTokens;
        const windowCap = candidate.model.contextWindow ? Math.max(512, Math.floor(candidate.model.contextWindow / 2)) : 8192;
        const maxOutput = Math.min(
          modelMax !== null && modelMax > 0 ? modelMax : Number.MAX_SAFE_INTEGER,
          outputCap,
          windowCap
        );
        return adapter.chat(
          context,
          {
            model: candidate.model.modelId,
            messages: built.messages,
            tools: this.executor.definitions(),
            maxOutputTokens: maxOutput
          },
          {
            signal,
            onText: (delta) => this.hooks.onText?.(delta)
          }
        );
      }
      async handleFailure(error, candidate, signal) {
        const classified = error instanceof ProviderError ? error : classifyThrown(error, candidate.profile.providerId);
        if (classified.category === "cancelled" || signal?.aborted) return "cancel";
        this.consecutiveFailures += 1;
        const enabledProfiles = this.store.listProfiles().filter((profile) => profile.enabled).length;
        const failureCap = Math.max(8, enabledProfiles * 6);
        if (this.consecutiveFailures > failureCap) {
          this.hooks.onNotice?.(
            `Stopping after ${failureCap} consecutive provider failures. Progress is saved; resume after checking quota.`
          );
          return "stop";
        }
        const key = Router.key(candidate.profile.id, candidate.model.modelId);
        this.store.addAttempt(this.task.id, {
          profileId: candidate.profile.id,
          modelId: candidate.model.modelId,
          category: classified.category,
          at: (/* @__PURE__ */ new Date()).toISOString()
        });
        this.store.recordProfileError(candidate.profile.id, classified.message);
        this.store.recordHealth({
          profileId: candidate.profile.id,
          ok: false,
          category: classified.category,
          message: classified.message
        });
        const resetLabel = classified.resetAt ? `Provider reset: ${classified.resetAt}.` : classified.retryAfterAt ? `Requested retry after: ${classified.retryAfterAt}.` : "Reset time unknown.";
        this.hooks.onNotice?.(
          `${describeCategory(classified.category)} on ${candidate.profile.name}/${candidate.model.modelId}: ${classified.message} ${resetLabel}`
        );
        if (classified.category === "context_length" && !this.contextSlim) {
          this.contextSlim = true;
          this.hooks.onNotice?.("Retrying with a reduced context window.");
          return "retry";
        }
        const KEY_ROTATION_CATEGORIES = [
          "rate_limit",
          "daily_quota",
          "invalid_api_key",
          "auth_failure",
          "billing_restriction",
          "permission_error"
        ];
        if (KEY_ROTATION_CATEGORIES.includes(classified.category)) {
          const profileId = candidate.profile.id;
          const count = this.keyCounts.get(profileId) ?? 1;
          const current = this.keyCursor.get(profileId) ?? 0;
          if (current + 1 < count) {
            this.keyCursor.set(profileId, current + 1);
            this.consecutiveFailures = Math.max(0, this.consecutiveFailures - 1);
            this.hooks.onNotice?.(
              `${candidate.profile.name}: ${classified.category} on key ${current + 1}/${count} \u2014 trying key ${current + 2}/${count}.`
            );
            return "retry";
          }
          this.keyCursor.set(profileId, 0);
          if (count > 1) {
            this.hooks.onNotice?.(
              `${candidate.profile.name}: all ${count} API keys returned ${classified.category} for ${candidate.model.modelId} \u2014 trying another model.`
            );
          }
        }
        const retryable = classified.category === "rate_limit" || classified.category === "provider_outage" || classified.category === "network";
        const failures = (this.retryCounts.get(key) ?? 0) + 1;
        this.retryCounts.set(key, failures);
        if (retryable && failures <= this.settings.routing.maxRetriesPerCandidate) {
          const delay = this.backoff(failures, classified);
          if (delay !== null && delay <= this.settings.routing.retryMaxDelayMs) {
            this.hooks.onRetry?.({
              attempt: this.consecutiveFailures,
              delayMs: delay,
              category: classified.category,
              message: classified.message
            });
            await sleep(delay, signal);
            if (signal?.aborted) return "cancel";
            return "retry";
          }
          if (delay !== null) {
            this.hooks.onNotice?.(
              `Provider requested a wait of ${Math.round(delay / 1e3)}s, which exceeds the ${Math.round(
                this.settings.routing.retryMaxDelayMs / 1e3
              )}s retry cap. Trying a fallback instead.`
            );
          }
        }
        this.hadFailure = true;
        this.lastFailureInfo = `${classified.category}: ${classified.message}`.slice(0, 160);
        const profileLevel = [
          "invalid_api_key",
          "auth_failure",
          "permission_error",
          "billing_restriction"
        ];
        if (profileLevel.includes(classified.category)) {
          this.excludedProfiles.add(candidate.profile.id);
          this.hooks.onNotice?.(
            `${candidate.profile.name} rejected this request (${classified.category}) \u2014 excluding this provider.`
          );
        } else {
          const weight = classified.category === "daily_quota" ? 2 : 1;
          const providerFailures = (this.profileFailures.get(candidate.profile.id) ?? 0) + weight;
          this.profileFailures.set(candidate.profile.id, providerFailures);
          if (providerFailures >= 5) {
            this.excludedProfiles.add(candidate.profile.id);
            this.hooks.onNotice?.(
              `${candidate.profile.name}: ${providerFailures} consecutive failures \u2014 moving to another provider.`
            );
          }
        }
        const shouldPersistLimit = profileLevel.includes(classified.category) || classified.category === "rate_limit" || classified.category === "daily_quota" || classified.category === "provider_outage" || classified.category === "network" || classified.category === "model_unavailable" || classified.category === "unsupported_tool_calling";
        if (shouldPersistLimit) {
          this.store.saveLimit({
            profileId: candidate.profile.id,
            modelId: profileLevel.includes(classified.category) ? "*" : candidate.model.modelId,
            category: classified.category,
            message: classified.message,
            retryAfterAt: classified.retryAfterAt,
            resetAt: classified.resetAt
          });
        }
        this.exclude.add(key);
        this.retryCounts.delete(key);
        this.contextSlim = false;
        this.candidate = null;
        return "fallback";
      }
      backoff(attempt, error) {
        const target = error.retryAfterAt ?? error.resetAt;
        if (target) {
          const delay = Date.parse(target) - Date.now();
          if (!Number.isFinite(delay)) return null;
          return Math.max(0, delay);
        }
        const base = this.settings.routing.retryBaseDelayMs;
        const max = this.settings.routing.retryMaxDelayMs;
        const exponential = base * Math.pow(2, Math.max(0, attempt - 1));
        const jitter = 0.75 + Math.random() * 0.5;
        return Math.min(max, Math.round(exponential * jitter));
      }
      recordTurnUsage(candidate, built, response) {
        const estimatedInput = estimateTokens(
          built.messages.map((message) => message.content).join("\n")
        );
        const estimatedOutput = estimateTokens(response.content) + (response.toolCalls.length ? estimateTokens(JSON.stringify(response.toolCalls)) : 0);
        const usage2 = response.usage ?? {
          inputTokens: estimatedInput,
          outputTokens: estimatedOutput,
          totalTokens: estimatedInput + estimatedOutput
        };
        const model = candidate.model;
        const cost = model.inputPricePerMillion !== null && model.outputPricePerMillion !== null ? usage2.inputTokens / 1e6 * model.inputPricePerMillion + usage2.outputTokens / 1e6 * model.outputPricePerMillion : null;
        this.store.recordUsage({
          taskId: this.task.id,
          profileId: candidate.profile.id,
          providerId: candidate.profile.providerId,
          modelId: model.modelId,
          inputTokens: usage2.inputTokens,
          outputTokens: usage2.outputTokens,
          costEstimate: cost,
          source: response.usage ? "provider" : "estimated"
        });
        this.store.recordProfileSuccess(candidate.profile.id);
        this.store.clearLimit(candidate.profile.id, model.modelId);
        this.store.clearLimit(candidate.profile.id, "*");
        this.retryCounts.delete(Router.key(candidate.profile.id, model.modelId));
        this.usage.inputTokens += usage2.inputTokens;
        this.usage.outputTokens += usage2.outputTokens;
        return usage2;
      }
      // ------------------------------------------------------------------- tools
      async executeTools(calls, signal) {
        let completed = false;
        for (const call of calls) {
          if (signal?.aborted) return false;
          this.hooks.onToolStart?.(call);
          this.updatePhaseForTool(call.name);
          const result = await this.executor.execute(call);
          this.hooks.onToolResult?.(call, result);
          this.store.appendMessage(this.task.id, {
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: result.content,
            isError: !result.ok
          });
          if (result.changedFiles?.length) {
            this.task = this.store.updateTask(this.task.id, {
              changedFiles: mergeUnique(this.task.changedFiles, result.changedFiles),
              relevantFiles: mergeUnique(this.task.relevantFiles, result.changedFiles).slice(0, 60)
            });
            for (const file of result.changedFiles) {
              if (!this.relevantFiles.some((entry) => entry.path === file)) {
                this.relevantFiles.push({ path: file, reason: "changed in this task" });
              }
            }
          }
          if (call.name === "task_complete" && result.ok) completed = true;
          if ((call.name === "run_tests" || call.name === "run_lint" || call.name === "run_build" || call.name === "verify_ui") && result.ok) {
            this.verificationRan = true;
          }
          this.checkpoint(`tool:${call.name}`);
          if (signal?.aborted) return false;
        }
        return completed || Boolean(this.completionSummary);
      }
      /**
       * Quality gate: write-capable modes that changed files must attempt the
       * configured verification commands once before task_complete is accepted.
       */
      shouldRequestVerification() {
        if (this.verificationRan || this.verificationNudged) return false;
        if (AGENT_MODES[this.mode]?.tools !== "all") return false;
        if (this.task.changedFiles.length === 0) return false;
        const agent = this.settings.agent;
        return Boolean(
          agent.testCommand || agent.lintCommand || agent.buildCommand || agent.uiVerifyCommand
        );
      }
      updatePhaseForTool(toolName) {
        const phases = {
          update_plan: "plan",
          write_file: "implement",
          edit_file: "implement",
          apply_patch: "implement",
          delete_file: "implement",
          run_tests: "test",
          run_lint: "test",
          run_build: "test",
          task_complete: "summarize"
        };
        const phase = phases[toolName];
        if (phase) this.setPhase(phase);
      }
      setPhase(phase) {
        if (this.task.phase === phase) return;
        this.task = this.store.updateTask(this.task.id, { phase });
        this.hooks.onPhase?.(phase);
      }
      /**
       * Optional tester pass: a separate configured model reviews the diff for
       * test gaps once per run. GAPS verdicts send the agent back to work.
       */
      async testIfEnabled() {
        const collaboration = this.settings.agent.collaboration;
        if (!collaboration.enabled || !collaboration.testerProfileId) return false;
        if (this.testerCycles >= 1) return false;
        if (this.task.changedFiles.length === 0) return false;
        this.testerCycles += 1;
        this.setPhase("test");
        const summary = this.completionSummary ?? this.finalResponse ?? this.task.summary ?? "";
        const test = await this.collaborator.test(this.task, this.task.changedFiles, summary);
        if (!test) return false;
        this.hooks.onReview?.(`[Tester ${test.modelId}]
${test.text.slice(0, 4e3)}`);
        this.store.appendMessage(this.task.id, {
          role: "system",
          content: `[Tester ${test.modelId}]
${test.text.slice(0, 8e3)}`
        });
        if (/VERDICT:\s*GAPS/i.test(test.text)) {
          this.store.appendMessage(this.task.id, {
            role: "user",
            content: `Tester feedback. Address these gaps, verify with tests, then call task_complete again:
${test.text.slice(0, 8e3)}`
          });
          return true;
        }
        return false;
      }
      // -------------------------------------------------------------- review/done
      async reviewIfEnabled() {
        const collaboration = this.settings.agent.collaboration;
        if (!collaboration.enabled || !collaboration.reviewerProfileId || !collaboration.reviewChanges) {
          return false;
        }
        if (this.reviewCycles >= 1) return false;
        if (this.task.changedFiles.length === 0) return false;
        this.reviewCycles += 1;
        this.setPhase("review");
        const summary = this.completionSummary ?? this.finalResponse ?? this.task.summary ?? "";
        const review = await this.collaborator.review(this.task, this.task.changedFiles, summary);
        if (!review) return false;
        this.hooks.onReview?.(review.text);
        this.store.appendMessage(this.task.id, {
          role: "system",
          content: `[Reviewer ${review.modelId}]
${review.text.slice(0, 8e3)}`
        });
        if (review.verdict === "issues") {
          this.store.appendMessage(this.task.id, {
            role: "user",
            content: `Reviewer feedback. Address these findings, verify with tests, then call task_complete again:
${review.text.slice(0, 8e3)}`
          });
          return true;
        }
        return false;
      }
      complete() {
        const latest = this.store.getTask(this.task.id);
        if (latest) this.task = latest;
        const summary = (this.completionSummary ?? this.finalResponse ?? this.task.summary ?? "Task completed.").slice(0, 8e3);
        const finalMetadata = recordGitFinalMetadata(this.task.projectPath, this.task);
        this.task = this.store.updateTask(this.task.id, {
          status: "completed",
          phase: "done",
          summary,
          error: null,
          completedAt: (/* @__PURE__ */ new Date()).toISOString(),
          pendingSteps: [],
          attempts: this.task.attempts,
          ...finalMetadata ? { metadata: finalMetadata } : {}
        });
        this.checkpoint("completed");
        this.hooks.onTaskComplete?.(summary);
        return {
          status: "completed",
          taskId: this.task.id,
          summary,
          pauseReason: null,
          finalResponse: this.finalResponse,
          usage: { ...this.usage },
          steps: this.steps
        };
      }
      halt(status, reason) {
        const safeReason = redactSecrets(reason);
        const latest = this.store.getTask(this.task.id);
        if (latest) this.task = latest;
        const finalMetadata = recordGitFinalMetadata(this.task.projectPath, this.task);
        this.task = this.store.updateTask(this.task.id, {
          status,
          phase: status === "failed" ? this.task.phase : "paused",
          error: safeReason,
          summary: this.completionSummary ?? this.task.summary,
          ...finalMetadata ? { metadata: finalMetadata } : {}
        });
        try {
          const messages = this.store.loadMessages(this.task.id, 5);
          const last = messages[messages.length - 1];
          if (!last || !(last.role === "system" && last.content.includes("[ComiCode paused]"))) {
            this.store.appendMessage(this.task.id, {
              role: "system",
              content: `[ComiCode ${status}] ${safeReason}`
            });
          }
          this.checkpoint(status);
        } catch (error) {
          logger.warn(`Failed to save pause checkpoint: ${String(error)}`);
        }
        this.hooks.onPaused?.(safeReason);
        return {
          status,
          taskId: this.task.id,
          summary: this.task.summary,
          pauseReason: safeReason,
          finalResponse: this.finalResponse,
          usage: { ...this.usage },
          steps: this.steps
        };
      }
      buildPauseReason() {
        const reasons = /* @__PURE__ */ new Map();
        for (const blocked of this.lastBlocked) {
          const label = blocked.reason;
          reasons.set(label, (reasons.get(label) ?? 0) + 1);
        }
        const detail = [...reasons.entries()].slice(0, 12).map(([reason, count]) => `- ${reason}${count > 1 ? ` (${count} candidates)` : ""}`).join("\n");
        const profiles = this.store.listProfiles();
        const intro = profiles.length === 0 ? "No provider profiles are connected." : "No eligible model/profile is currently available.";
        const policy = this.router.policy;
        const policyNotes = [];
        if (!policy.allowPaid) policyNotes.push("paid fallbacks are disabled");
        if (!policy.allowUnknownAccess) policyNotes.push("unknown-access models are disabled");
        if (policy.excludedProviders.length) {
          policyNotes.push(`excluded providers: ${policy.excludedProviders.join(", ")}`);
        }
        const lines = [intro];
        if (detail) lines.push("Reasons:", detail);
        if (policyNotes.length) lines.push(`Policy: ${policyNotes.join("; ")}.`);
        lines.push(
          `Progress and checkpoints were saved. Check quota/reset status with "comicode usage", add another profile if needed, then resume with "comicode resume ${this.task.id}".`
        );
        return lines.join("\n");
      }
      checkpoint(reason) {
        try {
          const latest = this.store.getTask(this.task.id);
          if (!latest) return;
          const messages = this.store.loadMessages(this.task.id, 300);
          const recentToolOutputs = messages.filter(
            (message) => message.role === "tool"
          ).slice(-8).map((message) => ({
            name: message.name,
            content: message.content.slice(0, 1200),
            at: (/* @__PURE__ */ new Date()).toISOString()
          }));
          const checkpoint = this.store.createCheckpoint(this.task.id, {
            task: latest,
            messages,
            summary: this.contextSummary,
            contextCache: this.contextCache,
            recentToolOutputs,
            savedAt: (/* @__PURE__ */ new Date()).toISOString()
          });
          this.task = this.store.getTask(this.task.id) ?? latest;
          this.hooks.onCheckpoint?.(checkpoint.id);
        } catch (error) {
          logger.warn(`Checkpoint (${reason}) failed: ${String(error)}`);
        }
      }
    };
  }
});

// src/cli/shared.ts
async function withStore(fn) {
  const context = openAppContext(process.cwd());
  try {
    return await fn(context);
  } finally {
    context.close();
  }
}
function authorityFrom(options) {
  return {
    allowFileWrites: Boolean(options.yes),
    allowCommands: Boolean(options.allowCommands),
    allowDangerousCommands: Boolean(options.allowDangerousCommands),
    allowSecrets: Boolean(options.allowSecrets),
    allowGitWrite: Boolean(options.allowCommands)
  };
}
function normalizeTaskType(value) {
  const allowed = ["coding", "reasoning", "review", "vision", "general"];
  if (!value) return "coding";
  if (!allowed.includes(value)) {
    throw new Error(`Invalid task type "${value}". Choose one of: ${allowed.join(", ")}.`);
  }
  return value;
}
function matchesReference(profile, reference) {
  const trimmed = reference.trim().toLowerCase();
  if (!trimmed) return false;
  if (profile.id.toLowerCase() === trimmed) return true;
  if (profile.name.toLowerCase() === trimmed) return true;
  if (`${profile.providerId}:${profile.name}`.toLowerCase() === trimmed) return true;
  if (`${providerDisplayName(profile.providerId)}:${profile.name}`.toLowerCase() === trimmed)
    return true;
  return false;
}
function resolveProfile(store, reference) {
  const profiles = store.listProfiles();
  if (profiles.length === 0) {
    throw new Error('No provider profiles are connected. Add one with "comicode providers add".');
  }
  if (!reference?.trim()) {
    const selectedId = store.getSelectedProfileId();
    const selected = selectedId ? profiles.find((profile) => profile.id === selectedId) : null;
    if (selected) return selected;
    const enabled = profiles.find((profile) => profile.enabled);
    if (enabled) return enabled;
    throw new Error("No enabled provider profile is available. Add or enable one first.");
  }
  const exact = profiles.filter((profile) => matchesReference(profile, reference));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(
      `Profile reference "${reference}" is ambiguous:
${exact.map(
        (profile) => `  ${profile.name} (${providerDisplayName(profile.providerId)}, ${profile.id})`
      ).join("\n")}`
    );
  }
  const lower = reference.trim().toLowerCase();
  const partial = profiles.filter(
    (profile) => profile.name.toLowerCase().includes(lower) || profile.id.toLowerCase().startsWith(lower)
  );
  if (partial.length === 1) return partial[0];
  const providerMatches = profiles.filter((profile) => profile.providerId === lower);
  if (providerMatches.length === 1) return providerMatches[0];
  if (partial.length > 1) {
    throw new Error(
      `Profile reference "${reference}" matches multiple profiles:
${partial.map((entry) => `  ${entry.name} (${entry.id})`).join("\n")}`
    );
  }
  throw new Error(
    `No profile matched "${reference}". Connected profiles:
${profiles.map(
      (profile) => `  ${profile.name} (${providerDisplayName(profile.providerId)}, ${profile.id})`
    ).join("\n")}`
  );
}
function resolveModel(store, reference, profileReference) {
  const profiles = store.listProfiles();
  if (profiles.length === 0) {
    throw new Error('No provider profiles are connected. Add one with "comicode providers add".');
  }
  const models = store.listModels();
  const trimmed = reference.trim();
  if (!trimmed) throw new Error("A model reference is required.");
  const profileFilter = profileReference ? resolveProfile(store, profileReference) : null;
  const byProfile = (model) => !profileFilter || model.profileId === profileFilter.id || model.profileId === null;
  const exactId = models.filter((model) => model.id === trimmed);
  if (exactId.length === 1) {
    const model = exactId[0];
    const profile = resolveModelProfile(store, model, profileFilter);
    return { model, profile };
  }
  if (trimmed.includes("/")) {
    const [head, ...rest] = trimmed.split("/");
    const tail = rest.join("/");
    if (head && tail) {
      try {
        const profile = profileFilter ?? resolveProfile(store, head);
        const model = models.find(
          (entry) => entry.modelId === tail && entry.providerId === profile.providerId && (entry.profileId === null || entry.profileId === profile.id)
        );
        if (model) return { model, profile };
      } catch {
      }
    }
  }
  const exactModel = models.filter((model) => model.modelId === trimmed && byProfile(model));
  if (exactModel.length === 1) {
    const model = exactModel[0];
    return { model, profile: resolveModelProfile(store, model, profileFilter) };
  }
  const partial = models.filter(
    (model) => byProfile(model) && (model.modelId.toLowerCase().includes(trimmed.toLowerCase()) || model.displayName.toLowerCase().includes(trimmed.toLowerCase()))
  );
  const unique = dedupeModels(partial);
  if (unique.length === 1) {
    const model = unique[0];
    return { model, profile: resolveModelProfile(store, model, profileFilter) };
  }
  if (unique.length > 1) {
    throw new Error(
      `Model reference "${trimmed}" is ambiguous. Candidates:
${unique.slice(0, 20).map((model) => `  ${model.id}`).join("\n")}`
    );
  }
  throw new Error(
    `No model matched "${trimmed}". Run "comicode models list" to see available models.`
  );
}
function dedupeModels(models) {
  const seen = /* @__PURE__ */ new Set();
  const output = [];
  for (const model of models) {
    const key = `${model.providerId}:${model.profileId ?? ""}:${model.modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(model);
  }
  return output;
}
function resolveModelProfile(store, model, preferred) {
  const profiles = store.listProfiles().filter((profile) => profile.providerId === model.providerId);
  if (model.profileId) {
    const scoped = store.getProfile(model.profileId);
    if (scoped) return scoped;
  }
  if (preferred && preferred.providerId === model.providerId) return preferred;
  const withDefault = profiles.find((profile) => profile.defaultModel === model.modelId);
  if (withDefault) return withDefault;
  const enabled = profiles.find((profile) => profile.enabled);
  if (enabled) return enabled;
  const first = profiles[0];
  if (first) return first;
  throw new Error(
    `No profile exists for provider "${model.providerId}". Connect the provider first.`
  );
}
function profileLabel(profile) {
  return `${profile.name} ${dim(`(${providerDisplayName(profile.providerId)})`)}`;
}
function formatPrice(model) {
  if (model.inputPricePerMillion === null && model.outputPricePerMillion === null) return "\u2014";
  const input = model.inputPricePerMillion ?? 0;
  const output = model.outputPricePerMillion ?? 0;
  if (input === 0 && output === 0) return "free";
  return `$${input.toFixed(2)}/$${output.toFixed(2)}`;
}
function formatContext(model) {
  return model.contextWindow ? formatTokens(model.contextWindow) : "\u2014";
}
function taskTitle(task) {
  const firstLine = task.userRequest.replace(/\s+/g, " ").trim();
  return firstLine.length > 72 ? `${firstLine.slice(0, 71)}\u2026` : firstLine || "(empty request)";
}
function printConfirmation(request) {
  console.log("");
  console.log(`${warning("Approval needed")}  ${bold(request.title)}`);
  console.log(dim(request.description));
  if (request.path) console.log(`${dim("path:")} ${request.path}`);
  if (request.command) console.log(`${dim("command:")} ${request.command}`);
  if (request.reasons?.length) {
    for (const reason of request.reasons) console.log(`${danger("risk:")} ${reason}`);
  }
  if (request.diff) {
    const lines = request.diff.split(/\r?\n/);
    const shown = lines.slice(0, 160);
    console.log(dim("\u2500".repeat(60)));
    for (const line of shown) {
      if (line.startsWith("+")) console.log(success(line));
      else if (line.startsWith("-")) console.log(danger(line));
      else console.log(dim(line));
    }
    if (lines.length > shown.length) {
      console.log(
        dim(`\u2026 ${lines.length - shown.length} more diff lines (full diff in checkpoint)`)
      );
    }
    console.log(dim("\u2500".repeat(60)));
  }
}
async function runTask(store, taskId, options = {}) {
  const json = Boolean(options.json);
  let streamedInTurn = false;
  let streamedAny = false;
  const hooks = {
    onText: (delta) => {
      if (json) return;
      streamedInTurn = true;
      streamedAny = true;
      process.stdout.write(delta);
    },
    onAssistantMessage: (content) => {
      if (json) return;
      if (streamedInTurn && content.trim()) process.stdout.write("\n");
      streamedInTurn = false;
    },
    onToolStart: (call) => {
      if (json) return;
      const args = JSON.stringify(call.arguments ?? {});
      console.log(
        `
${dim("\u2192")} ${bold(call.name)} ${dim(args.length > 160 ? `${args.slice(0, 159)}\u2026` : args)}`
      );
    },
    onToolResult: (call, result2) => {
      if (json) return;
      const firstLine = result2.content.split(/\r?\n/).find((line) => line.trim()) ?? "";
      const label = result2.ok ? success("\u2714") : danger("\u2716");
      console.log(`${label} ${dim(`${call.name}: ${firstLine.slice(0, 220)}`)}`);
    },
    onRoute: (decision) => {
      if (json) return;
      if (streamedAny) console.log("");
      console.log(
        `${dim("\u25C7 route")} ${bold(decision.candidate.profile.name)}/${bold(
          decision.candidate.model.modelId
        )} ${dim(`\u2014 ${decision.reason}`)}`
      );
    },
    onNotice: (message) => {
      if (json) return;
      console.log(`${warning("!")} ${message}`);
    },
    onRetry: (info) => {
      if (json) return;
      console.log(
        `${warning("\u21BB")} retrying ${info.category} in ${(info.delayMs / 1e3).toFixed(1)}s (attempt ${info.attempt})`
      );
    },
    onUsage: (usage2, candidate) => {
      if (json) return;
      console.log(
        dim(
          `  tokens: ${formatTokens(usage2.inputTokens)} in / ${formatTokens(
            usage2.outputTokens
          )} out \xB7 ${candidate.profile.name}/${candidate.model.modelId}`
        )
      );
    },
    onPlan: (plan) => {
      if (json) return;
      const value = plan;
      if (!value?.steps) return;
      console.log(`
${bold("Plan")} ${dim(value.summary ?? "")}`);
      for (const step of value.steps) {
        console.log(dim(`  [${step.status}] ${step.title}`));
      }
    },
    onReview: (review) => {
      if (json) return;
      console.log(`
${bold("Reviewer")}
${review}`);
    },
    onCheckpoint: () => {
    },
    onPaused: (reason) => {
      if (json) return;
      console.log("");
      console.log(warning("Paused"));
      console.log(reason);
    },
    onTaskComplete: (summary) => {
      if (json) return;
      console.log("");
      console.log(success("Completed"));
      if (summary) console.log(summary);
    },
    confirm: async (request) => {
      if (json || !isInteractive()) {
        console.log(
          `${warning("!")} ${request.title} was not approved because no interactive confirmation is available.`
        );
        console.log(dim(`  Re-run with ${AUTHORITY_FLAGS.join(", ")} as appropriate.`));
        return "deny";
      }
      printConfirmation(request);
      return await promptConfirm("Approve this action?", false) ? "allow" : "deny";
    }
  };
  const agent = new CodingAgent({
    store,
    taskId,
    hooks,
    authority: authorityFrom(options),
    settings: store.getSettings(),
    routingOverrides: options.allowPaid ? { allowPaid: true } : void 0
  });
  let result;
  try {
    result = await agent.run({
      resume: options.resume,
      signal: options.signal,
      maxSteps: options.maxSteps
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      console.log(JSON.stringify({ ok: false, taskId, error: message }, null, 2));
    } else {
      console.log(`${danger("\u2716")} ${message}`);
    }
    return {
      status: "failed",
      taskId,
      summary: null,
      pauseReason: message,
      finalResponse: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      steps: 0
    };
  }
  if (json) {
    const task = store.getTask(taskId);
    console.log(
      JSON.stringify(
        {
          ok: result.status === "completed",
          result,
          task,
          usageTotals: store.usageTotals()
        },
        null,
        2
      )
    );
  } else {
    console.log(
      dim(
        `
${result.steps} steps \xB7 ${formatTokens(result.usage.inputTokens)} in / ${formatTokens(
          result.usage.outputTokens
        )} out \xB7 task ${result.taskId}`
      )
    );
  }
  return result;
}
function createTaskForRequest(store, cwd, request, options = {}) {
  const inspector = new ProjectInspector(cwd);
  const projectName = inspector.projectName();
  return store.createTask({
    projectPath: cwd,
    projectName,
    userRequest: request,
    taskType: options.taskType ?? "coding",
    currentProfileId: options.profileId ?? null,
    currentModelId: options.modelId ?? null,
    metadata: { createdBy: "cli", source: "comicode" }
  });
}
function resultExitCode(result) {
  if (result.status === "completed") return 0;
  if (result.status === "paused") return 2;
  return 1;
}
function printResumeHint(result) {
  if (result.status === "paused") {
    console.log(
      dim(`Resume with: comicode resume ${result.taskId}  (progress and checkpoints are saved)`)
    );
  }
}
var AUTHORITY_FLAGS;
var init_shared = __esm({
  "src/cli/shared.ts"() {
    "use strict";
    init_app();
    init_agent();
    init_definitions();
    init_catalog();
    init_inspector();
    init_output();
    init_prompt();
    AUTHORITY_FLAGS = [
      "--yes (file edits)",
      "--allow-commands (shell commands)",
      "--allow-dangerous-commands (risky shell commands)",
      "--allow-secrets (protected files)",
      "--allow-paid (paid fallbacks for this run)"
    ];
  }
});

// src/cli/commands/providers.ts
var providers_exports = {};
__export(providers_exports, {
  EndpointConfigSchema: () => EndpointConfigSchema,
  addProvider: () => addProvider,
  describeKey: () => describeKey,
  registerProviderCommands: () => registerProviderCommands
});
import { existsSync as existsSync7, readFileSync as readFileSync10, writeFileSync as writeFileSync3 } from "fs";
import { resolve as resolve4 } from "path";
function parseProviderKind(value) {
  if (PROVIDER_ORDER.includes(value)) return value;
  throw new Error(
    `Unknown provider "${value}". Choose one of: ${PROVIDER_ORDER.join(", ")}. Use "custom" with --base-url for any OpenAI-compatible or Gemini-compatible platform.`
  );
}
function parseAccess(value) {
  if (!value) return null;
  if (!ACCESS_CLASSIFICATIONS.includes(value)) {
    throw new Error(
      `Unknown access classification "${value}". Choose one of: ${ACCESS_CLASSIFICATIONS.join(", ")}.`
    );
  }
  return value;
}
function parseExtraHeaders(values) {
  const headers = {};
  for (const raw of values ?? []) {
    const index = raw.indexOf(":");
    if (index <= 0) throw new Error(`Invalid header "${raw}". Use "Name: Value".`);
    const name = raw.slice(0, index).trim();
    const value = raw.slice(index + 1).trim();
    if (!/^[A-Za-z0-9-]+$/.test(name)) throw new Error(`Invalid header name "${name}".`);
    if (/authorization|api[-_]?key|cookie/i.test(name)) {
      throw new Error(
        `Header "${name}" is credential-like. Configure the API key separately so it is stored securely.`
      );
    }
    headers[name] = value;
  }
  return headers;
}
function buildEndpointConfig(flags, existing) {
  const base = readEndpointConfig(existing ?? { config: {} });
  const config = { ...base };
  if (flags.apiStyle) {
    if (flags.apiStyle !== "openai-compatible" && flags.apiStyle !== "gemini") {
      throw new Error('--api-style must be "openai-compatible" or "gemini".');
    }
    config.apiStyle = flags.apiStyle;
  }
  if (flags.auth === false) config.allowNoAuth = true;
  if (flags.auth === true) config.allowNoAuth = false;
  if (flags.authHeader) config.authHeader = flags.authHeader;
  if (flags.authPrefix !== void 0) config.authPrefix = flags.authPrefix;
  if (flags.chatPath) config.chatPath = flags.chatPath;
  if (flags.modelsPath) config.modelsPath = flags.modelsPath;
  if (flags.maxTokensParam) {
    if (flags.maxTokensParam !== "max_tokens" && flags.maxTokensParam !== "max_completion_tokens") {
      throw new Error("--max-tokens-param must be max_tokens or max_completion_tokens.");
    }
    config.maxTokensParam = flags.maxTokensParam;
  }
  if (flags.discovery === false) config.supportsModelDiscovery = false;
  if (flags.discovery === true) config.supportsModelDiscovery = true;
  if (flags.streaming === false) config.supportsStreaming = false;
  if (flags.streaming === true) config.supportsStreaming = true;
  if (flags.testChat) config.testWithChat = true;
  if (flags.contextWindow) {
    const value = Number(flags.contextWindow);
    if (!Number.isInteger(value) || value <= 0)
      throw new Error("--context-window must be a positive integer.");
    config.contextWindowOverride = value;
  }
  if (flags.priority) {
    const value = Number(flags.priority);
    if (!Number.isFinite(value)) throw new Error("--priority must be a number.");
    config.priority = value;
  }
  const extra = parseExtraHeaders(flags.extraHeader);
  if (Object.keys(extra).length) {
    config.extraHeaders = { ...base.extraHeaders ?? {}, ...extra };
  }
  if (flags.preset) config.preset = flags.preset;
  return endpointConfigForStorage(config);
}
function validateBaseUrl(value) {
  if (!value.trim()) throw new Error("A base URL is required.");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `Invalid base URL "${value}". Include the scheme, for example https://api.example.com/v1`
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The base URL must use http:// or https://.");
  }
}
function uniqueName(existing, base, ignoreId) {
  const names = new Set(
    existing.filter((profile) => profile.id !== ignoreId).map((profile) => profile.name.toLowerCase())
  );
  if (!names.has(base.toLowerCase())) return base;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base} ${index}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error("Could not generate a unique profile name.");
}
async function maybeStoreKey(profile, key, envName) {
  if (envName) return "env";
  if (!key) return "none";
  const keys = parseKeyInput(key);
  if (keys.length === 0) return "none";
  for (const entry of keys) registerSecret(entry);
  await getCredentialStore().setSecret(
    credentialIdForProfile(profile.id),
    keysToSecret(keys)
  );
  return "stored";
}
function printProfileSummary(profile, keyState) {
  const config = readEndpointConfig(profile);
  printKeyValue([
    ["Name", profile.name],
    ["Provider", providerDisplayName(profile.providerId)],
    ["Base URL", profile.baseUrl || dim("(none)")],
    ["API style", profile.providerId === "gemini" ? "gemini" : config.apiStyle],
    [
      "Auth",
      keyState === "env" ? `environment (${profile.apiKeyEnv})` : keyState === "stored" ? "stored securely" : "none"
    ],
    ["Default model", profile.defaultModel ?? dim("(none)")],
    ["Enabled", profile.enabled ? success("yes") : warning("no")],
    ["Access", profile.accessClassification],
    ["Discovery", config.supportsModelDiscovery ? "enabled" : "disabled"],
    ["Streaming", config.supportsStreaming ? "enabled" : "disabled"]
  ]);
}
async function interactiveProviderDraft(existing) {
  let providerId = existing?.providerId ?? "custom";
  let preset = existing ? readEndpointConfig(existing).preset : null;
  let baseUrl = existing?.baseUrl ?? "";
  let apiStyle = existing ? readEndpointConfig(existing).apiStyle : void 0;
  let authHeader;
  let authPrefix;
  let defaultModel = existing?.defaultModel ?? null;
  let discovery = existing ? readEndpointConfig(existing).supportsModelDiscovery : true;
  let streaming = existing ? readEndpointConfig(existing).supportsStreaming : true;
  if (!existing) {
    const mode = await promptChoice("How do you want to connect a provider?", [
      {
        value: "builtin",
        label: "Built-in provider",
        hint: "Gemini, Groq, OpenRouter, OpenAI"
      },
      {
        value: "preset",
        label: "Custom platform preset",
        hint: "DeepSeek, Mistral, xAI, Together, Ollama, Azure, ..."
      },
      {
        value: "custom",
        label: "Any other API",
        hint: "OpenAI-compatible or Gemini-compatible with your base URL"
      }
    ]);
    if (mode === "builtin") {
      providerId = await promptChoice(
        "Provider",
        PROVIDER_ORDER.filter((kind) => kind !== "custom").map((kind) => ({
          value: kind,
          label: getProviderDefinition(kind).name,
          hint: getProviderDefinition(kind).defaultBaseUrl
        }))
      );
    } else if (mode === "preset") {
      const choice = await promptChoice(
        "Preset",
        PROVIDER_PRESETS.map((entry) => ({
          value: entry.id,
          label: entry.label,
          hint: entry.baseUrl
        }))
      );
      const found = PROVIDER_PRESETS.find((entry) => entry.id === choice);
      if (found) {
        providerId = "custom";
        preset = found.id;
        baseUrl = found.baseUrl;
        apiStyle = found.apiStyle;
        authHeader = found.authHeader;
        authPrefix = found.authPrefix;
        defaultModel = found.exampleModel;
      }
    } else {
      providerId = "custom";
    }
  }
  const definition = getProviderDefinition(providerId);
  const name = await promptText("Profile name", {
    defaultValue: existing?.name ?? (preset ? PROVIDER_PRESETS.find((p) => p.id === preset)?.label : definition.name),
    required: true
  });
  baseUrl = await promptText("Base URL", {
    defaultValue: baseUrl || definition.defaultBaseUrl,
    required: true,
    validate: (value) => {
      try {
        validateBaseUrl(value);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
  });
  if (providerId === "custom") {
    apiStyle = await promptChoice(
      "API protocol",
      [
        { value: "openai-compatible", label: "OpenAI-compatible", hint: "/chat/completions" },
        { value: "gemini", label: "Gemini-compatible", hint: "/models/{model}:generateContent" }
      ],
      { defaultIndex: apiStyle === "gemini" ? 1 : 0 }
    );
    if (apiStyle === "gemini") {
      authHeader = void 0;
      authPrefix = void 0;
    }
  }
  defaultModel = await promptText("Default model (optional)", {
    defaultValue: defaultModel ?? "",
    allowEmpty: true
  }) || null;
  const access = await promptChoice(
    "How should ComiCode classify this profile for routing?",
    [
      { value: "unknown", label: "Unknown", hint: "allowed, but not preferred" },
      { value: "user-free", label: "Free for me", hint: "local server or free credits" },
      { value: "user-paid", label: "Paid for me", hint: "blocked unless allowPaid is on" },
      { value: "unavailable", label: "Unavailable", hint: "disable routing use" }
    ],
    { defaultIndex: 0 }
  );
  let keyMode = "secret";
  let apiKeyEnv = existing?.apiKeyEnv ?? null;
  if (providerId === "custom") {
    if (definition.authType === "api-key" && apiStyle === "gemini") {
      keyMode = "secret";
    } else {
      keyMode = await promptChoice("Authentication", [
        { value: "secret", label: "Store an API key securely", hint: "OS credential store" },
        {
          value: "env",
          label: "Read an environment variable",
          hint: "keeps the key out of the database"
        },
        { value: "none", label: "No authentication", hint: "local servers only" }
      ]);
    }
    if (keyMode === "env") {
      apiKeyEnv = await promptText("Environment variable name", {
        defaultValue: apiKeyEnv ?? "",
        required: true
      });
    }
  } else if (apiStyle !== "gemini") {
    keyMode = await promptChoice("Authentication", [
      { value: "secret", label: "Store an API key securely" },
      { value: "env", label: "Read an environment variable" }
    ]);
    if (keyMode === "env") {
      apiKeyEnv = await promptText("Environment variable name", {
        defaultValue: apiKeyEnv ?? "",
        required: true
      });
    }
  }
  if (providerId !== "custom" || definition.authType === "api-key") {
    keyMode = "secret";
  }
  const key = keyMode === "secret" ? await promptSecret(
    existing ? "New API key(s), comma-separated for multiple (blank keeps existing)" : "API key(s), comma-separated for multiple (input is hidden)"
  ).catch(() => "") : null;
  discovery = await promptConfirm("Use the endpoint model list for discovery?", discovery);
  streaming = await promptConfirm("Stream responses when supported?", streaming);
  return {
    providerId,
    name,
    baseUrl,
    defaultModel,
    access,
    apiStyle,
    noAuth: keyMode === "none",
    keyMode,
    apiKeyEnv: keyMode === "env" ? apiKeyEnv : null,
    key: key && key.trim() ? key.trim() : null,
    discovery,
    streaming,
    preset,
    authHeader,
    authPrefix
  };
}
async function addProvider(flags) {
  const providerId = flags.provider ? parseProviderKind(flags.provider) : null;
  const preset = flags.preset ? PROVIDER_PRESETS.find((entry) => entry.id === flags.preset) : null;
  if (flags.preset && !preset) {
    throw new Error(
      `Unknown preset "${flags.preset}". Available presets: ${PROVIDER_PRESETS.map((entry) => entry.id).join(", ")}.`
    );
  }
  const interactive = isInteractive() && (!providerId || !flags.baseUrl || !flags.name);
  const draft = interactive ? await interactiveProviderDraft(null) : null;
  const resolvedProvider = draft?.providerId ?? providerId ?? (preset ? "custom" : "custom");
  const definition = getProviderDefinition(resolvedProvider);
  const baseUrl = draft?.baseUrl ?? flags.baseUrl ?? preset?.baseUrl ?? definition.defaultBaseUrl;
  validateBaseUrl(baseUrl);
  const baseName = draft?.name ?? flags.name ?? preset?.label ?? definition.name;
  const existing = await withStore(({ store }) => store.listProfiles());
  const name = uniqueName(existing, baseName);
  const config = buildEndpointConfig(
    {
      ...flags,
      preset: draft?.preset ?? flags.preset,
      apiStyle: draft?.apiStyle ?? flags.apiStyle,
      authHeader: draft?.authHeader ?? flags.authHeader,
      authPrefix: draft?.authPrefix ?? flags.authPrefix,
      auth: draft?.noAuth ? false : flags.auth,
      discovery: draft ? draft.discovery : flags.discovery,
      streaming: draft ? draft.streaming : flags.streaming
    },
    void 0
  );
  if (preset?.apiStyle) config.apiStyle = preset.apiStyle;
  if (preset?.authHeader) config.authHeader = preset.authHeader;
  if (preset?.authPrefix !== void 0) config.authPrefix = preset.authPrefix;
  const keyMode = draft?.keyMode ?? (flags.apiKeyEnv ? "env" : flags.apiKey ? "secret" : flags.auth === false ? "none" : "secret");
  if (keyMode === "none") config.allowNoAuth = true;
  if (draft && !draft.noAuth) delete config.allowNoAuth;
  const access = draft?.access ?? parseAccess(flags.access) ?? (keyMode === "none" ? "user-free" : "unknown");
  const result = await withStore(async ({ store }) => {
    const profile = store.createProfile({
      providerId: resolvedProvider,
      name,
      baseUrl,
      authType: preset?.authHeader === "api-key" ? "api-key" : definition.authType,
      defaultModel: draft?.defaultModel ?? flags.defaultModel ?? null,
      apiKeyEnv: draft?.apiKeyEnv ?? flags.apiKeyEnv ?? null,
      accessClassification: access,
      config,
      enabled: flags.enabled !== false && !flags.disabled
    });
    let key = draft?.key ?? flags.apiKey ?? null;
    if (!key && keyMode === "secret" && isInteractive() && !draft) {
      key = await promptSecret("API key(s), comma-separated for multiple (input is hidden)").catch(
        () => ""
      );
    }
    const keyState = await maybeStoreKey(
      profile,
      key && key.trim() ? key.trim() : null,
      profile.apiKeyEnv
    );
    if (keyState === "none" && resolvedProvider !== "custom" && definition.authType === "bearer") {
      console.log(
        warning(
          `No API key is configured. Set one with "comicode auth set ${profile.name}" or an environment variable before using this profile.`
        )
      );
    }
    if (keyState === "none" && resolvedProvider === "custom" && !readEndpointConfig(profile).allowNoAuth) {
      console.log(
        warning(
          `No API key is configured. If this endpoint is local, edit the profile with --no-auth.`
        )
      );
    }
    return { profile, keyState };
  });
  console.log("");
  console.log(`${success("\u2714")} Profile "${result.profile.name}" created.`);
  printProfileSummary(result.profile, result.keyState);
  if (flags.test || flags.refresh) {
    await withStore(async ({ store }) => {
      const fresh = store.getProfile(result.profile.id);
      if (!fresh) return;
      const test = await testProfileConnection(store, fresh);
      console.log("");
      console.log(
        test.ok ? `${success("\u2714")} ${test.message} ${dim(`(${test.latencyMs}ms)`)}` : `${danger("\u2716")} ${test.message}`
      );
      if (test.ok && readEndpointConfig(fresh).supportsModelDiscovery) {
        try {
          const refreshed = await refreshProfileModels(store, fresh);
          console.log(
            `${success("\u2714")} Discovered ${refreshed.discovered} model${refreshed.discovered === 1 ? "" : "s"}.`
          );
          if (!fresh.defaultModel) {
            const models = store.listModels(fresh.providerId, fresh.providerId === "custom" ? fresh.id : void 0).filter((model) => model.profileId === null || model.profileId === fresh.id).sort((a, b) => b.codingSuitability - a.codingSuitability);
            const best = models[0];
            if (best) {
              store.updateProfile(fresh.id, { defaultModel: best.modelId });
              console.log(dim(`Default model set to ${best.modelId}.`));
            }
          }
        } catch (error) {
          const classified = classifyThrown(error, fresh.providerId);
          console.log(
            `${danger("\u2716")} Model refresh failed (${classified.category}): ${classified.message}`
          );
        }
      }
    });
  }
  const profiles = await withStore(({ store }) => store.listProfiles());
  if (profiles.length === 1) {
    await withStore(({ store }) => store.setSelectedProfileId(result.profile.id));
  }
}
function applyFlagPatch(flags, existing) {
  const patch = {};
  if (flags.name) patch.name = flags.name;
  if (flags.baseUrl) {
    validateBaseUrl(flags.baseUrl);
    patch.baseUrl = flags.baseUrl;
  }
  if (flags.defaultModel !== void 0) patch.defaultModel = flags.defaultModel || null;
  if (flags.apiKeyEnv !== void 0) patch.apiKeyEnv = flags.apiKeyEnv || null;
  if (flags.enabled !== void 0) patch.enabled = flags.enabled;
  const access = parseAccess(flags.access);
  if (access) patch.accessClassification = access;
  const config = buildEndpointConfig(flags, existing);
  if (Object.keys(config).length) patch.config = config;
  return patch;
}
async function editProvider(reference, flags) {
  await withStore(async ({ store }) => {
    const profile = resolveProfile(store, reference);
    const hasFlags = Object.keys(flags).some((key2) => {
      const value = flags[key2];
      return value !== void 0 && value !== false;
    });
    if (!hasFlags && isInteractive()) {
      const draft = await interactiveProviderDraft(profile);
      const update = {
        name: uniqueName(store.listProfiles(), draft.name, profile.id),
        baseUrl: draft.baseUrl,
        defaultModel: draft.defaultModel,
        apiKeyEnv: draft.apiKeyEnv,
        accessClassification: draft.access,
        config: buildEndpointConfig(
          {
            apiStyle: draft.apiStyle,
            authHeader: draft.authHeader,
            authPrefix: draft.authPrefix,
            preset: draft.preset ?? void 0,
            auth: draft.noAuth ? false : void 0,
            discovery: draft.discovery,
            streaming: draft.streaming
          },
          profile
        )
      };
      const updated2 = store.updateProfile(profile.id, update);
      const keyState2 = await maybeStoreKey(updated2, draft.key, updated2.apiKeyEnv);
      console.log(`${success("\u2714")} Updated ${updated2.name}.`);
      printProfileSummary(updated2, keyState2);
      return;
    }
    const patch = applyFlagPatch(flags, profile);
    if (Object.keys(patch).length === 0) {
      console.log(
        dim(
          "No changes requested. Use flags such as --name, --base-url, --default-model, --api-key-env, --access, --no-auth."
        )
      );
      return;
    }
    if (patch.name) patch.name = uniqueName(store.listProfiles(), patch.name, profile.id);
    const updated = store.updateProfile(profile.id, patch);
    let key = flags.apiKey ?? null;
    if (!key && isInteractive() && flags.apiKeyEnv === void 0 && Object.keys(flags).length === 0) {
      key = await promptSecret("New API key (leave blank to keep existing)").catch(() => "");
    }
    const keyState = await maybeStoreKey(updated, key, updated.apiKeyEnv);
    console.log(`${success("\u2714")} Updated ${updated.name}.`);
    printProfileSummary(updated, keyState);
  });
}
function listProviders(options) {
  return withStore(({ store }) => {
    const profiles = store.listProfiles();
    const storedIds = new Set(getCredentialStore().listSecretIds());
    const authLabel = (profile) => {
      if (profile.apiKeyEnv) return `env:${profile.apiKeyEnv}`;
      if (readEndpointConfig(profile).allowNoAuth) return "none";
      return storedIds.has(credentialIdForProfile(profile.id)) ? "stored" : "missing";
    };
    if (options.json) {
      jsonOut(
        profiles.map((profile) => ({
          ...profile,
          models: store.listModels(
            profile.providerId,
            profile.providerId === "custom" ? profile.id : void 0
          ).filter((model) => model.profileId === null || model.profileId === profile.id).length,
          activeLimits: store.listLimits(true).filter((limit) => limit.profileId === profile.id)
        }))
      );
      return;
    }
    printTitleSafe("Provider profiles", `${profiles.length} connected`);
    printTable(
      ["NAME", "PROVIDER", "DEFAULT MODEL", "AUTH", "ACCESS", "STATUS", "LAST OK"],
      profiles.map((profile) => [
        profile.name,
        providerDisplayName(profile.providerId),
        profile.defaultModel ?? "\u2014",
        authLabel(profile),
        profile.accessClassification,
        profile.enabled ? success("enabled") : warning("disabled"),
        formatRelative(profile.lastSuccessAt)
      ])
    );
    if (profiles.length === 0) {
      console.log("");
      console.log(`Add one with ${bold("comicode providers add")} or any custom platform with`);
      console.log(
        dim(
          '  comicode providers add --provider custom --base-url https://api.example.com/v1 --name "My platform" --api-key ...'
        )
      );
    }
  });
}
function printTitleSafe(title, subtitle) {
  console.log("");
  console.log(`${bold("COMICODE")}  ${dim(subtitle ?? "")}`);
  console.log(bold(title));
}
async function showProvider(reference) {
  await withStore(({ store }) => {
    const profile = resolveProfile(store, reference);
    const config = readEndpointConfig(profile);
    printSection(profile.name);
    printKeyValue([
      ["ID", profile.id],
      ["Provider", providerDisplayName(profile.providerId)],
      ["Base URL", profile.baseUrl],
      ["API style", profile.providerId === "gemini" ? "gemini" : config.apiStyle],
      ["API key env", profile.apiKeyEnv ?? dim("(none)")],
      ["Default model", profile.defaultModel ?? dim("(none)")],
      ["Enabled", profile.enabled ? success("yes") : warning("no")],
      ["Access classification", profile.accessClassification],
      ["Last success", formatDateTime(profile.lastSuccessAt)],
      ["Last check", formatDateTime(profile.lastCheckedAt)],
      ["Last error", profile.lastError ? danger(profile.lastError) : dim("(none)")],
      ["Models discovered at", formatDateTime(profile.modelsRefreshedAt)],
      ["Chat path", config.chatPath],
      ["Models path", config.modelsPath],
      ["Auth header", config.authHeader],
      ["No auth", config.allowNoAuth ? "yes" : "no"],
      ["Discovery", config.supportsModelDiscovery ? "yes" : "no"],
      ["Streaming", config.supportsStreaming ? "yes" : "no"],
      ["Priority", String(config.priority ?? 100)]
    ]);
    const limits2 = store.listLimits(true).filter((limit) => limit.profileId === profile.id);
    if (limits2.length) {
      printSection("Active limits");
      printTable(
        ["MODEL", "CATEGORY", "RESET", "MESSAGE"],
        limits2.map((limit) => [
          limit.modelId,
          limit.category,
          formatDateTime(limit.resetAt ?? limit.retryAfterAt),
          truncate(limit.message ?? "\u2014", 60)
        ])
      );
    }
    const health = store.listHealth(profile.id, 5);
    if (health.length) {
      printSection("Recent health");
      printTable(
        ["WHEN", "OK", "LATENCY", "CATEGORY", "MESSAGE"],
        health.map((entry) => [
          formatRelative(entry.createdAt),
          entry.ok ? success("yes") : danger("no"),
          entry.latencyMs === null ? "\u2014" : `${entry.latencyMs}ms`,
          entry.category ?? "\u2014",
          truncate(entry.message ?? "\u2014", 50)
        ])
      );
    }
    const models = store.listModels(profile.providerId, profile.providerId === "custom" ? profile.id : void 0).filter((model) => model.profileId === null || model.profileId === profile.id);
    printSection(`Models (${models.length})`);
    for (const model of models.slice(0, 25)) {
      console.log(
        `  ${model.modelId}${model.available ? "" : dim(" (stale)")} ${dim(`[${model.access}]`)}`
      );
    }
    if (models.length > 25) console.log(dim(`  \u2026 ${models.length - 25} more`));
  });
}
async function removeProvider(reference, options) {
  await withStore(async ({ store }) => {
    const profile = resolveProfile(store, reference);
    if (!options.yes && isInteractive()) {
      const confirmed = await promptConfirm(
        `Delete profile "${profile.name}" and its stored credential? This cannot be undone.`,
        false
      );
      if (!confirmed) {
        console.log(dim("Cancelled."));
        return;
      }
    } else if (!options.yes) {
      throw new Error("Deleting a profile requires --yes in non-interactive mode.");
    }
    await removeProfile(store, profile.id);
    console.log(`${success("\u2714")} Deleted ${profile.name}.`);
  });
}
function presets(options) {
  if (options.json) {
    jsonOut(PROVIDER_PRESETS);
    return;
  }
  printSection("Custom platform presets");
  printTable(
    ["PRESET", "BASE URL", "PROTOCOL", "KEY", "EXAMPLE MODEL"],
    PROVIDER_PRESETS.map((preset) => [
      preset.id,
      preset.baseUrl,
      preset.apiStyle,
      preset.requiresKey ? "required" : "optional",
      preset.exampleModel
    ])
  );
  console.log("");
  console.log(
    dim(
      "Presets are shortcuts, not restrictions. Any OpenAI-compatible or Gemini-compatible endpoint works:"
    )
  );
  console.log(
    dim(
      '  comicode providers add --provider custom --name "My API" --base-url https://host/v1 --api-key ...'
    )
  );
}
async function testProvider(reference, options) {
  return withStore(async ({ store }) => {
    const profile = resolveProfile(store, reference);
    console.log(dim(`Testing ${profileLabel(profile)} \u2026`));
    const result = await testProfileConnection(store, profile);
    if (options.json) {
      jsonOut({ profile: profile.id, ...result });
    } else if (result.ok) {
      console.log(
        `${success("\u2714")} ${result.message} ${dim(`(${result.latencyMs}ms${result.modelCount !== null ? `, ${result.modelCount} models` : ""})`)}`
      );
    } else {
      console.log(`${danger("\u2716")} ${result.message}`);
      console.log(dim(`Category: ${result.category ?? "unknown"}`));
    }
    return result.ok ? 0 : 1;
  });
}
async function refreshModels(reference, options) {
  return withStore(async ({ store }) => {
    const profile = resolveProfile(store, reference);
    console.log(dim(`Refreshing models for ${profileLabel(profile)} \u2026`));
    try {
      const result = await refreshProfileModels(store, profile);
      const models = store.listModels(profile.providerId, profile.providerId === "custom" ? profile.id : void 0).filter((model) => model.profileId === null || model.profileId === profile.id);
      if (options.json) {
        jsonOut({ profile: profile.id, ...result, models });
      } else {
        console.log(
          `${success("\u2714")} Discovered ${result.discovered} model${result.discovered === 1 ? "" : "s"} in ${result.latencyMs}ms.`
        );
        if (!profile.defaultModel) {
          const best = models.filter((model) => model.available).sort((a, b) => b.codingSuitability - a.codingSuitability)[0];
          if (best) {
            store.updateProfile(profile.id, { defaultModel: best.modelId });
            console.log(dim(`Default model set to ${best.modelId}.`));
          }
        }
      }
      return 0;
    } catch (error) {
      const classified = classifyThrown(error, profile.providerId);
      if (options.json) jsonOut({ profile: profile.id, ok: false, ...classified.toJSON() });
      else console.log(`${danger("\u2716")} ${classified.message} (${classified.category})`);
      return 1;
    }
  });
}
async function exportProfiles(file) {
  await withStore(({ store }) => {
    const payload = exportProviders(store);
    const text = `${JSON.stringify(payload, null, 2)}
`;
    if (file) {
      const path = resolve4(process.cwd(), file);
      writeFileSync3(path, text, "utf8");
      console.log(`${success("\u2714")} Exported ${payload.profiles.length} profiles to ${path}.`);
      console.log(dim("Credentials are never included. Re-add API keys after importing."));
    } else {
      process.stdout.write(text);
    }
  });
}
async function importProfiles(file) {
  const path = resolve4(process.cwd(), file);
  if (!existsSync7(path)) throw new Error(`File not found: ${path}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync10(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  await withStore(({ store }) => {
    const summary = importProviders(store, parsed);
    console.log(
      `${success("\u2714")} Imported profiles: ${summary.created} created, ${summary.updated} updated, ${summary.skipped} skipped.`
    );
    for (const item of summary.warnings) console.log(`${warning("!")} ${item}`);
    if (summary.created + summary.updated > 0) {
      console.log(dim('Set API keys with "comicode auth set <profile>".'));
    }
  });
}
function registerProviderCommands(program) {
  const providers = program.command("providers").alias("provider").description("Manage provider profiles, including custom base URLs").option("--json", "machine-readable output").action(async (options) => {
    await listProviders(options);
  });
  providers.command("list").alias("ls").description("List connected provider profiles").option("--json", "machine-readable output").action(async (options) => {
    await listProviders(options);
  });
  providers.command("add").description("Add a provider profile (interactive by default)").option("--provider <kind>", "gemini, groq, openrouter, openai, or custom").option("--preset <id>", 'custom platform preset (see "providers presets")').option("--name <name>", "profile name").option("--base-url <url>", "API base URL (any compatible platform)").option(
    "--api-key <key>",
    "API key (prefer interactive input or --api-key-env to avoid shell history)"
  ).option("--api-key-env <name>", "read the API key from this environment variable").option("--default-model <model>", "default model id").option("--api-style <style>", "openai-compatible or gemini (custom endpoints)").option("--auth-header <header>", "credential header name (default Authorization)").option("--auth-prefix <prefix>", 'credential header prefix (default "Bearer ")').option("--chat-path <path>", "chat completions path").option("--models-path <path>", "model list path").option("--max-tokens-param <name>", "max_tokens or max_completion_tokens").option("--context-window <tokens>", "context window override").option(
    "--extra-header <header>",
    'additional header "Name: Value" (repeatable)',
    (value, previous = []) => [...previous, value]
  ).option("--access <classification>", ACCESS_CLASSIFICATIONS.join("|")).option("--priority <number>", "routing priority, lower is preferred").option("--no-auth", "endpoint does not require an API key (local servers)").option("--no-discovery", "disable the model list endpoint").option("--no-streaming", "disable streaming").option("--test-chat", "allow a tiny live chat request when discovery is disabled").option("--disabled", "create the profile disabled").option("--test", "test the connection after adding").option("--refresh", "refresh models after adding").action(async (options) => {
    await addProvider(options);
  });
  providers.command("edit [profile]").description("Edit a provider profile").option("--name <name>").option("--base-url <url>").option("--api-key <key>").option("--api-key-env <name>").option("--default-model <model>").option("--api-style <style>").option("--auth-header <header>").option("--auth-prefix <prefix>").option("--chat-path <path>").option("--models-path <path>").option("--max-tokens-param <name>").option("--context-window <tokens>").option(
    "--extra-header <header>",
    'additional header "Name: Value" (repeatable)',
    (value, previous = []) => [...previous, value]
  ).option("--access <classification>").option("--priority <number>").option("--no-auth").option("--no-discovery").option("--no-streaming").option("--test-chat").option("--enable", "enable the profile").option("--disable", "disable the profile").action(
    async (reference, options) => {
      if (options.enable) options.enabled = true;
      if (options.disable) options.enabled = false;
      await editProvider(reference, options);
    }
  );
  providers.command("show [profile]").description("Show profile details, health, limits, and models").action(async (reference) => {
    await showProvider(reference ?? "");
  });
  providers.command("remove [profile]").alias("delete").description("Remove a provider profile and its stored credential").option("--yes", "do not prompt for confirmation").action(async (reference, options) => {
    await removeProvider(reference ?? "", options);
  });
  providers.command("enable [profile]").description("Enable a provider profile").action(async (reference) => {
    await withStore(({ store }) => {
      const profile = resolveProfile(store, reference);
      store.updateProfile(profile.id, { enabled: true });
      console.log(`${success("\u2714")} Enabled ${profile.name}.`);
    });
  });
  providers.command("disable [profile]").description("Disable a provider profile").action(async (reference) => {
    await withStore(({ store }) => {
      const profile = resolveProfile(store, reference);
      store.updateProfile(profile.id, { enabled: false });
      console.log(`${success("\u2714")} Disabled ${profile.name}.`);
    });
  });
  providers.command("test [profile]").description("Test a provider connection").option("--json", "machine-readable output").action(async (reference, options) => {
    const code = await testProvider(reference, options);
    if (code !== 0) process.exitCode = code;
  });
  providers.command("refresh [profile]").alias("models").description("Refresh models from a provider").option("--json", "machine-readable output").action(async (reference, options) => {
    const code = await refreshModels(reference, options);
    if (code !== 0) process.exitCode = code;
  });
  providers.command("presets").description("List custom platform presets").option("--json", "machine-readable output").action((options) => presets(options));
  providers.command("export [file]").description("Export non-secret profile configuration (never credentials)").action(async (file) => {
    await exportProfiles(file);
  });
  providers.command("import <file>").description("Import non-secret profile configuration").action(async (file) => {
    await importProfiles(file);
  });
}
function describeKey(key) {
  return maskSecret(key);
}
var init_providers = __esm({
  "src/cli/commands/providers.ts"() {
    "use strict";
    init_credentials();
    init_redact();
    init_service();
    init_definitions();
    init_profile_config();
    init_errors();
    init_settings();
    init_masking();
    init_output();
    init_prompt();
    init_shared();
  }
});

// src/cli/commands/models.ts
function owningProfile(profiles, model) {
  if (model.profileId) {
    return profiles.find((profile) => profile.id === model.profileId) ?? null;
  }
  return profiles.find(
    (profile) => profile.providerId === model.providerId && profile.defaultModel === model.modelId
  ) ?? profiles.find((profile) => profile.providerId === model.providerId && profile.enabled) ?? profiles.find((profile) => profile.providerId === model.providerId) ?? null;
}
async function listModels(options) {
  await withStore(({ store }) => {
    const profiles = store.listProfiles();
    const enabledProviderIds = new Set(
      profiles.filter((profile) => profile.enabled).map((profile) => profile.providerId)
    );
    const filterProfile = options.profile ? resolveProfile(store, options.profile) : null;
    let models = store.listModels();
    if (!options.all) {
      models = models.filter(
        (model) => profiles.some((profile) => profile.providerId === model.providerId)
      );
    }
    if (filterProfile) {
      models = models.filter(
        (model) => model.providerId === filterProfile.providerId && (model.profileId === null || model.profileId === filterProfile.id)
      );
    }
    if (options.provider) {
      models = models.filter((model) => model.providerId === options.provider);
    }
    if (options.search) {
      const needle = options.search.toLowerCase();
      models = models.filter(
        (model) => model.modelId.toLowerCase().includes(needle) || model.displayName.toLowerCase().includes(needle)
      );
    }
    if (options.tools) models = models.filter((model) => model.supportsTools);
    if (options.vision) models = models.filter((model) => model.supportsVision);
    if (options.available) models = models.filter((model) => model.available);
    if (options.free) {
      models = models.filter((model) => {
        const owner = owningProfile(profiles, model);
        const access = effectiveAccess(model, owner?.accessClassification ?? null);
        return isFreeAccess(access);
      });
    }
    const limit = options.limit ? Number(options.limit) : 200;
    if (Number.isFinite(limit) && limit > 0) models = models.slice(0, limit);
    if (options.json) {
      jsonOut(
        models.map((model) => {
          const owner = owningProfile(profiles, model);
          return {
            ...model,
            effectiveAccess: effectiveAccess(model, owner?.accessClassification ?? null),
            profileName: owner?.name ?? null
          };
        })
      );
      return;
    }
    const selectedModelId = store.getSelectedModelId();
    printSection("Models");
    console.log(
      dim(
        `${models.length} model${models.length === 1 ? "" : "s"} \xB7 ${profiles.length} profile${profiles.length === 1 ? "" : "s"}${options.free ? " \xB7 free only" : ""}`
      )
    );
    printTable(
      ["MODEL", "PROFILE / PROVIDER", "ACCESS", "CTX", "PRICE IN/OUT", "TOOLS", "VISION", "STATUS"],
      models.map((model) => {
        const owner = owningProfile(profiles, model);
        const access = effectiveAccess(model, owner?.accessClassification ?? null);
        const selected = selectedModelId === model.id ? success("\u25CF ") : "";
        return [
          `${selected}${model.modelId}`,
          `${owner?.name ?? "\u2014"} ${dim(providerDisplayName(model.providerId))}`,
          access === "free-confirmed" || access === "user-free" ? success(ACCESS_LABELS[access]) : access === "paid" || access === "user-paid" ? warning(ACCESS_LABELS[access]) : access === "unavailable" ? danger(ACCESS_LABELS[access]) : dim(ACCESS_LABELS[access]),
          formatContext(model),
          formatPrice(model),
          model.supportsTools ? "yes" : "no",
          model.supportsVision ? "yes" : "no",
          !model.available ? danger("stale") : !enabledProviderIds.has(model.providerId) ? warning("profile off") : "available"
        ];
      })
    );
    if (models.length === 0) {
      console.log("");
      console.log(
        `No models matched. Refresh with ${bold("comicode models refresh")} or add one manually with ${bold(
          "comicode models add <profile> <model-id>"
        )}.`
      );
    }
  });
}
async function refreshModels2(reference, options) {
  return withStore(async ({ store }) => {
    const profiles = reference ? [resolveProfile(store, reference)] : store.listProfiles().filter((profile) => profile.enabled);
    if (profiles.length === 0) throw new Error("No enabled profiles to refresh.");
    let failures = 0;
    const results = [];
    for (const profile of profiles) {
      try {
        const result = await refreshProfileModels(store, profile);
        results.push({ profile: profile.name, ok: true, ...result });
        if (!options.json) {
          console.log(
            `${success("\u2714")} ${profile.name}: ${result.discovered} model${result.discovered === 1 ? "" : "s"} (${result.latencyMs}ms)`
          );
        }
      } catch (error) {
        failures += 1;
        const classified = classifyThrown(error, profile.providerId);
        results.push({ profile: profile.name, ok: false, ...classified.toJSON() });
        if (!options.json) {
          console.log(
            `${danger("\u2716")} ${profile.name}: ${classified.message} (${classified.category})`
          );
        }
      }
    }
    if (options.json) jsonOut(results);
    return failures === 0 ? 0 : 1;
  });
}
async function addModel(profileReference, modelId, options) {
  await withStore(async ({ store }) => {
    const profile = resolveProfile(store, profileReference);
    await addManualModel(store, profile, modelId);
    if (options.default || !profile.defaultModel) {
      store.updateProfile(profile.id, { defaultModel: modelId.trim() });
    }
    const model = store.listModels(profile.providerId, profile.providerId === "custom" ? profile.id : void 0).find(
      (entry) => entry.modelId === modelId.trim() && (entry.profileId === null || entry.profileId === profile.id)
    );
    if (options.json) {
      jsonOut({ profile: profile.name, model });
      return;
    }
    console.log(`${success("\u2714")} Added ${modelId.trim()} to ${profile.name}.`);
    console.log(
      dim(
        "Capabilities are assumed until verified. Refresh the provider catalog for real metadata when available."
      )
    );
  });
}
async function removeModel(reference, options) {
  await withStore(async ({ store }) => {
    const { model } = resolveModel(store, reference, options.profile);
    if (!options.yes) {
      if (!isInteractive())
        throw new Error("Deleting a model requires --yes in non-interactive mode.");
      const confirmed = await promptConfirm(
        `Remove model "${model.modelId}" from the catalog?`,
        false
      );
      if (!confirmed) {
        console.log(dim("Cancelled."));
        return;
      }
    }
    store.deleteModel(model.id);
    if (store.getSelectedModelId() === model.id) store.setSelectedModelId(null);
    const owner = model.profileId ? store.getProfile(model.profileId) : null;
    if (owner?.defaultModel === model.modelId && owner.providerId === model.providerId) {
      store.updateProfile(owner.id, { defaultModel: null });
    }
    console.log(`${success("\u2714")} Removed ${model.modelId}.`);
  });
}
async function selectModel(reference, options) {
  await withStore(({ store }) => {
    const { model, profile } = resolveModel(store, reference, options.profile);
    if (!profile.enabled) {
      throw new Error(
        `Profile "${profile.name}" is disabled. Enable it with "comicode providers enable ${profile.name}".`
      );
    }
    store.setSelectedProfileId(profile.id);
    store.setSelectedModelId(model.id);
    if (options.json) {
      jsonOut({ profile: profile.id, model: model.id, modelId: model.modelId });
      return;
    }
    console.log(
      `${success("\u2714")} Selected ${bold(model.modelId)} via ${profile.name} (${providerDisplayName(model.providerId)}).`
    );
    const access = effectiveAccess(model, profile.accessClassification);
    if (isPaidAccess(access)) {
      console.log(
        warning(
          "This model is classified as paid. Explicit selections are honored, but fallbacks remain blocked unless allowPaid is enabled."
        )
      );
    } else if (access === "unknown") {
      console.log(
        dim(
          "Access is unknown. Routing policy controls whether unknown models may be used as fallbacks."
        )
      );
    }
  });
}
async function setDefaultModel(profileReference, modelReference) {
  await withStore(({ store }) => {
    const profile = resolveProfile(store, profileReference);
    const { model } = resolveModel(store, modelReference, profile.name);
    store.updateProfile(profile.id, { defaultModel: model.modelId });
    console.log(`${success("\u2714")} Default model for ${profile.name} is now ${bold(model.modelId)}.`);
  });
}
async function classifyModel(reference, access, options) {
  await withStore(({ store }) => {
    const { model } = resolveModel(store, reference, options.profile);
    if (access === "auto" || access === "clear" || access === "default") {
      store.setUserClassification(model.id, null);
      console.log(`${success("\u2714")} Cleared the user classification for ${model.modelId}.`);
      return;
    }
    if (!ACCESS_CLASSIFICATIONS.includes(access)) {
      throw new Error(
        `Unknown access classification "${access}". Choose: ${ACCESS_CLASSIFICATIONS.join(", ")} or auto.`
      );
    }
    store.setUserClassification(model.id, access);
    console.log(
      `${success("\u2714")} ${model.modelId} is now classified as ${ACCESS_LABELS[access]}.`
    );
    console.log(dim("User classifications override provider metadata for routing."));
  });
}
async function showModel(reference, options) {
  await withStore(({ store }) => {
    const { model, profile } = resolveModel(store, reference, options.profile);
    if (options.json) {
      jsonOut({ ...model, profileName: profile.name });
      return;
    }
    const access = effectiveAccess(model, profile.accessClassification);
    printSection(model.displayName);
    printTable(
      ["FIELD", "VALUE"],
      [
        ["Model ID", model.modelId],
        ["Provider", providerDisplayName(model.providerId)],
        ["Profile", profile.name],
        ["Access", ACCESS_LABELS[access]],
        ["Access source", model.accessSource],
        ["User override", model.userClassification ?? "\u2014"],
        ["Context window", model.contextWindow?.toLocaleString() ?? "\u2014"],
        ["Max output", model.maxOutputTokens?.toLocaleString() ?? "\u2014"],
        ["Tools", model.supportsTools ? "yes" : "no"],
        ["Streaming", model.supportsStreaming ? "yes" : "no"],
        ["Vision", model.supportsVision ? "yes" : "no"],
        ["Coding suitability", `${model.codingSuitability}/5`],
        ["Reasoning suitability", `${model.reasoningSuitability}/5`],
        ["Input price / M", formatPrice(model).split("/")[0] ?? "\u2014"],
        ["Output price / M", formatPrice(model).split("/")[1] ?? "\u2014"],
        ["Available", model.available ? success("yes") : warning("stale")],
        ["Last checked", model.lastCheckedAt ?? "\u2014"],
        ["Notes", truncate(model.accessNotes ?? "\u2014", 100)]
      ]
    );
    console.log("");
    console.log(dim(`Select with: comicode models select ${model.id}`));
  });
}
function registerModelCommands(program) {
  const models = program.command("models").description("Inspect, refresh, and select models").option("--profile <profile>", "limit to one profile").option("--provider <provider>", "limit to one provider kind").option("--free", "only free or user-free models").option("--tools", "only models with tool calling").option("--vision", "only vision models").option("--available", "only currently available models").option("--all", "include providers without a connected profile").option("--search <text>", "filter by model id or name").option("--limit <number>", "maximum rows", "200").option("--json", "machine-readable output").action(async (options) => {
    await listModels(options);
  });
  models.command("list").alias("ls").description("List models").option("--profile <profile>", "limit to one profile").option("--provider <provider>", "limit to one provider kind").option("--free", "only free or user-free models").option("--tools", "only models with tool calling").option("--vision", "only vision models").option("--available", "only currently available models").option("--all", "include providers without a connected profile").option("--search <text>", "filter by model id or name").option("--limit <number>", "maximum rows", "200").option("--json", "machine-readable output").action(async (options) => {
    await listModels(options);
  });
  models.command("refresh [profile]").description("Refresh model catalogs (all enabled profiles by default)").option("--json", "machine-readable output").action(async (reference, options) => {
    const code = await refreshModels2(reference, options);
    if (code !== 0) process.exitCode = code;
  });
  models.command("add <profile> <modelId>").description("Add a model manually (useful when discovery is unavailable)").option("--default", "also set it as the profile default").option("--json", "machine-readable output").action(async (profile, modelId, options) => {
    await addModel(profile, modelId, options);
  });
  models.command("remove <model>").alias("rm").description("Remove a model from the catalog").option("--profile <profile>", "disambiguate the model by profile").option("--yes", "do not prompt for confirmation").action(async (reference, options) => {
    await removeModel(reference, options);
  });
  models.command("select <model>").alias("use").description("Select the model used by new tasks").option("--profile <profile>", "disambiguate the model by profile").option("--json", "machine-readable output").action(async (reference, options) => {
    await selectModel(reference, options);
  });
  models.command("default <profile> <model>").description("Set a profile default model").action(async (profile, model) => {
    await setDefaultModel(profile, model);
  });
  models.command("classify <model> <access>").description(`Override access classification (${ACCESS_CLASSIFICATIONS.join("|")}|auto)`).option("--profile <profile>", "disambiguate the model by profile").action(async (reference, access, options) => {
    await classifyModel(reference, access, options);
  });
  models.command("show <model>").description("Show model metadata").option("--profile <profile>", "disambiguate the model by profile").option("--json", "machine-readable output").action(async (reference, options) => {
    await showModel(reference, options);
  });
}
var init_models = __esm({
  "src/cli/commands/models.ts"() {
    "use strict";
    init_settings();
    init_catalog();
    init_service();
    init_definitions();
    init_errors();
    init_output();
    init_prompt();
    init_shared();
  }
});

// src/cli/commands/tasks.ts
function resolveTaskId(tasks, reference) {
  const trimmed = reference.trim();
  const exact = tasks.find((task) => task.id === trimmed);
  if (exact) return exact;
  const prefix = tasks.filter((task) => task.id.startsWith(trimmed));
  if (prefix.length === 1) return prefix[0];
  if (prefix.length > 1) {
    throw new Error(`Task id "${reference}" is ambiguous. Use more characters.`);
  }
  throw new Error(`Task not found: ${reference}`);
}
function listTasks(options) {
  return withStore(({ store, cwd }) => {
    const statuses = options.status ? options.status.split(",").map((entry) => entry.trim()) : void 0;
    const tasks = store.listTasks({
      projectPath: options.all ? void 0 : options.project ?? cwd,
      statuses,
      limit: options.limit ? Number(options.limit) : 30
    });
    if (options.json) {
      jsonOut(tasks);
      return;
    }
    printSection("Tasks");
    console.log(
      dim(
        `${tasks.length} shown${options.all ? " across all projects" : ` for ${options.project ?? cwd}`}`
      )
    );
    printTable(
      ["ID", "STATUS", "PHASE", "UPDATED", "MODEL", "REQUEST"],
      tasks.map((task) => [
        task.id.slice(0, 8),
        statusLabel(task.status),
        task.phase,
        formatDateTime(task.updatedAt),
        task.currentModelId ?? "\u2014",
        truncate(taskTitle(task), 52)
      ])
    );
    if (tasks.length === 0) {
      console.log("");
      console.log(
        `Start a task with ${bold('comicode run "<request>"')} or the interactive ${bold("comicode")} UI.`
      );
    }
  });
}
function showTask(reference, options) {
  return withStore(({ store }) => {
    const task = resolveTaskId(store.listTasks({ limit: 1e3 }), reference);
    if (options.json) {
      jsonOut({
        task,
        messages: options.messages ? store.loadStoredMessages(task.id, Number(options.limit ?? 100)) : void 0,
        checkpoints: store.listCheckpoints(task.id, 10)
      });
      return;
    }
    printSection("Task");
    printKeyValue([
      ["ID", task.id],
      ["Project", `${task.projectName} (${task.projectPath})`],
      ["Status", statusLabel(task.status)],
      ["Phase", task.phase],
      ["Type", task.taskType],
      ["Created", formatDateTime(task.createdAt)],
      ["Updated", formatDateTime(task.updatedAt)],
      ["Completed", formatDateTime(task.completedAt)],
      ["Resumes", String(task.resumeCount)],
      ["Model", `${task.currentProfileId ?? "\u2014"} / ${task.currentModelId ?? "\u2014"}`],
      ["Checkpoint", task.lastCheckpointId ?? "\u2014"]
    ]);
    printSection("Request");
    console.log(task.userRequest);
    if (task.plan) {
      printSection(`Plan: ${task.plan.summary}`);
      for (const step of task.plan.steps) {
        console.log(`  [${step.status}] ${step.title}`);
      }
    }
    if (task.changedFiles.length) {
      printSection("Changed files");
      for (const file of task.changedFiles) console.log(`  ${file}`);
    }
    if (task.attempts.length) {
      printSection("Attempts");
      printTable(
        ["WHEN", "PROFILE", "MODEL", "CATEGORY"],
        task.attempts.slice(-15).map((attempt) => [
          formatDateTime(attempt.at),
          store.getProfile(attempt.profileId)?.name ?? attempt.profileId.slice(0, 8),
          attempt.modelId,
          attempt.category
        ])
      );
    }
    if (task.summary) {
      printSection("Summary");
      console.log(task.summary);
    }
    if (task.error) {
      printSection("Error");
      console.log(danger(task.error));
    }
    if (options.messages) {
      printSection("Messages");
      const messages = store.loadStoredMessages(task.id, Number(options.limit ?? 60));
      for (const message of messages) {
        const label = message.role === "assistant" ? bold("assistant") : message.role === "user" ? success("user") : message.role === "tool" ? dim(`tool:${message.name ?? "tool"}`) : dim(message.role);
        if (message.toolCalls?.length) {
          console.log(
            `
${label} ${dim(`[calls: ${message.toolCalls.map((call) => call.name).join(", ")}]`)}`
          );
        } else {
          console.log(`
${label}${message.isError ? danger(" (error)") : ""}`);
        }
        console.log(truncate(message.content, 1200));
      }
    }
  });
}
function listCheckpoints(reference, options) {
  return withStore(({ store }) => {
    const task = resolveTaskId(store.listTasks({ limit: 1e3 }), reference);
    const checkpoints = store.listCheckpoints(task.id, 50);
    if (options.json) {
      jsonOut(checkpoints);
      return;
    }
    printSection(`Checkpoints for ${task.id.slice(0, 8)}`);
    printTable(
      ["SEQ", "CREATED", "MESSAGES", "SUMMARY"],
      checkpoints.map((checkpoint) => [
        String(checkpoint.seq),
        formatDateTime(checkpoint.createdAt),
        String(checkpoint.state.messages?.length ?? 0),
        truncate(checkpoint.state.summary ?? "\u2014", 60)
      ])
    );
  });
}
async function deleteTask(reference, options) {
  await withStore(async ({ store }) => {
    const task = resolveTaskId(store.listTasks({ limit: 1e3 }), reference);
    if (!options.yes) {
      if (!isInteractive())
        throw new Error("Deleting a task requires --yes in non-interactive mode.");
      const confirmed = await promptConfirm(
        `Delete task ${task.id.slice(0, 8)} ("${taskTitle(task)}") and its history?`,
        false
      );
      if (!confirmed) {
        console.log(dim("Cancelled."));
        return;
      }
    }
    store.deleteTask(task.id);
    console.log(`${success("\u2714")} Deleted task ${task.id.slice(0, 8)}.`);
  });
}
function history(options) {
  return withStore(({ store, cwd }) => {
    const limit = options.limit ? Number(options.limit) : 40;
    if (options.routing) {
      const events = store.listRoutingEvents(limit);
      if (options.json) {
        jsonOut(events);
        return;
      }
      printSection("Routing events");
      printTable(
        ["WHEN", "TASK", "FROM", "TO", "REASON"],
        events.map((event) => [
          formatDateTime(event.createdAt),
          event.taskId ? event.taskId.slice(0, 8) : "\u2014",
          `${event.fromProfileId ? store.getProfile(event.fromProfileId)?.name ?? event.fromProfileId.slice(0, 6) : "\u2014"}/${event.fromModelId ?? "\u2014"}`,
          `${event.toProfileId ? store.getProfile(event.toProfileId)?.name ?? event.toProfileId.slice(0, 6) : "\u2014"}/${event.toModelId ?? "\u2014"}`,
          truncate(event.reason, 50)
        ])
      );
      return;
    }
    const tasks = store.listTasks({
      projectPath: options.all ? void 0 : cwd,
      limit
    });
    if (options.json) {
      jsonOut(tasks);
      return;
    }
    printSection("History");
    printTable(
      ["WHEN", "STATUS", "PROJECT", "MODEL", "REQUEST"],
      tasks.map((task) => [
        formatDateTime(task.updatedAt),
        statusLabel(task.status),
        task.projectName,
        task.currentModelId ?? "\u2014",
        truncate(taskTitle(task), 50)
      ])
    );
    const totals = store.usageTotals();
    console.log("");
    console.log(
      dim(
        `${formatTokens(totals.inputTokens + totals.outputTokens)} tokens used across ${totals.events} provider calls.`
      )
    );
    if (tasks.some((task) => task.status === "paused")) {
      console.log(warning('Some tasks are paused. Resume with "comicode resume <task-id>".'));
    }
  });
}
function usageSummary() {
  console.log(dim('Use "comicode usage" for detailed usage and limits.'));
}
function registerTaskCommands(program) {
  const tasks = program.command("tasks").description("Inspect and manage persisted tasks");
  tasks.command("list").alias("ls").description("List tasks for the current project").option("--all", "include tasks from other projects").option("--project <path>", "filter by project path").option("--status <statuses>", "comma-separated statuses").option("--limit <number>", "maximum rows", "30").option("--json", "machine-readable output").action(async (options) => {
    await listTasks(options);
  });
  tasks.command("show <id>").description("Show task details").option("--messages", "include the stored transcript").option("--limit <number>", "message limit", "60").option("--json", "machine-readable output").action(async (reference, options) => {
    await showTask(reference, options);
  });
  tasks.command("checkpoints <id>").description("List task checkpoints").option("--json", "machine-readable output").action(async (reference, options) => {
    await listCheckpoints(reference, options);
  });
  tasks.command("delete <id>").alias("rm").description("Delete a task and its history").option("--yes", "do not prompt for confirmation").action(async (reference, options) => {
    await deleteTask(reference, options);
  });
  program.command("history").description("Show task history or routing events").option("--routing", "show routing events instead of tasks").option("--all", "include tasks from other projects").option("--limit <number>", "maximum rows", "40").option("--json", "machine-readable output").action(async (options) => {
    await history(options);
    if (!options.routing) usageSummary();
    void providerDisplayName;
  });
}
var init_tasks = __esm({
  "src/cli/commands/tasks.ts"() {
    "use strict";
    init_definitions();
    init_output();
    init_prompt();
    init_shared();
  }
});

// src/cli/commands/usage.ts
function money(value) {
  if (value === null) return "\u2014";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(5)}`;
  return `$${value.toFixed(3)}`;
}
async function usage(options) {
  await withStore(({ store }) => {
    const now = /* @__PURE__ */ new Date();
    let since;
    let label = "All time";
    if (options.today) {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      since = start.toISOString();
      label = "Today";
    } else if (options.days) {
      const days = Number(options.days);
      if (!Number.isFinite(days) || days <= 0) throw new Error("--days must be a positive number.");
      since = new Date(Date.now() - days * 864e5).toISOString();
      label = `Last ${days} days`;
    }
    const totals = store.usageTotals(since);
    const byModel = store.usageByModel(since);
    const limits2 = store.listLimits(true);
    if (options.json) {
      jsonOut({ period: label, since: since ?? null, totals, byModel, limits: limits2 });
      return;
    }
    printSection(`Usage \u2014 ${label}`);
    printKeyValue([
      ["Input tokens", formatTokens(totals.inputTokens)],
      ["Output tokens", formatTokens(totals.outputTokens)],
      ["Total tokens", formatTokens(totals.inputTokens + totals.outputTokens)],
      ["Estimated cost", money(totals.cost)],
      ["Provider calls", String(totals.events)]
    ]);
    if (byModel.length) {
      printSection("By model");
      printTable(
        ["MODEL", "PROFILE", "INPUT", "OUTPUT", "CALLS", "COST"],
        byModel.map((entry) => [
          entry.modelId,
          store.getProfile(entry.profileId)?.name ?? dim("removed"),
          formatTokens(entry.inputTokens),
          formatTokens(entry.outputTokens),
          String(entry.events),
          money(entry.costEstimate)
        ])
      );
    } else {
      console.log("");
      console.log(dim("No usage recorded for this period."));
    }
    printSection("Active limits");
    if (limits2.length === 0) {
      console.log(dim("No active provider limits."));
    } else {
      printTable(
        ["PROFILE", "MODEL", "CATEGORY", "RESET", "MESSAGE"],
        limits2.map((limit) => [
          store.getProfile(limit.profileId)?.name ?? limit.profileId.slice(0, 8),
          limit.modelId,
          describeCategory(limit.category),
          formatDateTime(limit.resetAt ?? limit.retryAfterAt),
          truncate(limit.message ?? "\u2014", 54)
        ])
      );
      console.log("");
      console.log(dim("Reset times are shown only when the provider supplied them."));
    }
    console.log("");
    console.log(
      dim(
        "Costs are estimates from catalog pricing; providers bill independently. Tokens may be estimated when a provider does not report usage."
      )
    );
  });
}
async function limits(options = {}) {
  await withStore(({ store }) => {
    if (options.clear) {
      const profile = resolveProfile(store, options.clear);
      if (options.model) {
        store.clearLimit(profile.id, options.model);
        console.log(`${success("\u2714")} Cleared limit for ${profile.name}/${options.model}.`);
      } else {
        const existing = store.listLimits(true).filter((limit) => limit.profileId === profile.id);
        store.clearLimitsForProfile(profile.id);
        console.log(
          `${success("\u2714")} Cleared ${existing.length} limit${existing.length === 1 ? "" : "s"} for ${profile.name}.`
        );
      }
      return;
    }
    const records = store.listLimits(!options.all);
    if (options.json) {
      jsonOut(records);
      return;
    }
    printSection(options.all ? "All provider limits" : "Active provider limits");
    if (records.length === 0) {
      console.log(dim("No active limits."));
      return;
    }
    printTable(
      ["PROFILE", "MODEL", "CATEGORY", "RESET", "UPDATED", "ATTEMPTS", "MESSAGE"],
      records.map((limit) => [
        store.getProfile(limit.profileId)?.name ?? dim("removed"),
        limit.modelId,
        describeCategory(limit.category),
        formatDateTime(limit.resetAt ?? limit.retryAfterAt),
        formatDateTime(limit.updatedAt),
        String(limit.attempts),
        truncate(limit.message ?? "\u2014", 44)
      ])
    );
    console.log("");
    console.log(
      dim(`Clear a stale limit with ${bold("comicode limits --clear <profile> [--model <id>]")}.`)
    );
    void warning;
    void danger;
  });
}
function registerUsageCommands(program) {
  program.command("usage").description("Show token usage, cost estimates, and active provider limits").option("--today", "only today").option("--days <number>", "rolling window in days").option("--all", "all time (default)").option("--json", "machine-readable output").action(async (options) => {
    await usage(options);
  });
  program.command("limits").description("Show or clear provider/reset limits").option("--all", "include expired limits").option("--clear <profile>", "clear limits for a profile").option("--model <model>", "limit clearing to one model id").option("--json", "machine-readable output").action(async (options) => {
    await limits(options);
  });
}
var init_usage = __esm({
  "src/cli/commands/usage.ts"() {
    "use strict";
    init_errors();
    init_output();
    init_shared();
  }
});

// src/cli/commands/settings.ts
import { existsSync as existsSync8, readFileSync as readFileSync11, writeFileSync as writeFileSync4 } from "fs";
import { resolve as resolve5 } from "path";
function getPath(settings, path) {
  return path.split(".").reduce((current, key) => {
    if (current && typeof current === "object") {
      return current[key];
    }
    return void 0;
  }, settings);
}
function setPath(settings, path, value) {
  const parts = path.split(".");
  let current = settings;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const next = current[key];
    if (!next || typeof next !== "object") {
      current[key] = {};
    }
    current = current[key];
  }
  current[parts[parts.length - 1]] = value;
}
function parseSettingValue(raw) {
  const trimmed = raw.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "[]") return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw new Error(
        `Invalid JSON value: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.includes(",")) {
    return trimmed.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return raw;
}
function formatValue(value) {
  if (value === null || value === void 0) return dim("null");
  if (typeof value === "boolean") return value ? success("true") : warning("false");
  if (Array.isArray(value)) return value.length ? value.join(", ") : dim("(empty)");
  return String(value);
}
async function showSettings(options) {
  await withStore(({ store }) => {
    const settings = store.getSettings();
    if (options.json) {
      jsonOut(settings);
      return;
    }
    printSection("Routing policy");
    printTable(
      ["SETTING", "VALUE"],
      [
        ["preferFree", formatValue(settings.routing.preferFree)],
        ["preferSameProvider", formatValue(settings.routing.preferSameProvider)],
        ["preferCoding", formatValue(settings.routing.preferCoding)],
        ["allowPaid", formatValue(settings.routing.allowPaid)],
        ["allowUnknownAccess", formatValue(settings.routing.allowUnknownAccess)],
        ["maxFallbacks", formatValue(settings.routing.maxFallbacks)],
        ["maxRetriesPerCandidate", formatValue(settings.routing.maxRetriesPerCandidate)],
        ["retryBaseDelayMs", formatValue(settings.routing.retryBaseDelayMs)],
        ["retryMaxDelayMs", formatValue(settings.routing.retryMaxDelayMs)],
        ["minContextWindow", formatValue(settings.routing.minContextWindow)],
        ["preferredProviders", formatValue(settings.routing.preferredProviders)],
        ["excludedProviders", formatValue(settings.routing.excludedProviders)]
      ]
    );
    printSection("Agent");
    printTable(
      ["SETTING", "VALUE"],
      [
        ["maxSteps", formatValue(settings.agent.maxSteps)],
        ["contextBudgetRatio", formatValue(settings.agent.contextBudgetRatio)],
        ["maxToolOutputChars", formatValue(settings.agent.maxToolOutputChars)],
        ["autoApproveReadOnly", formatValue(settings.agent.autoApproveReadOnly)],
        ["autoApproveFileEdits", formatValue(settings.agent.autoApproveFileEdits)],
        ["autoApproveCommands", formatValue(settings.agent.autoApproveCommands)],
        ["allowSecretAccess", formatValue(settings.agent.allowSecretAccess)],
        ["testCommand", formatValue(settings.agent.testCommand)],
        ["lintCommand", formatValue(settings.agent.lintCommand)],
        ["buildCommand", formatValue(settings.agent.buildCommand)],
        ["collaboration.enabled", formatValue(settings.agent.collaboration.enabled)],
        [
          "collaboration.plannerProfileId",
          formatValue(settings.agent.collaboration.plannerProfileId)
        ],
        [
          "collaboration.reviewerProfileId",
          formatValue(settings.agent.collaboration.reviewerProfileId)
        ],
        ["collaboration.reviewChanges", formatValue(settings.agent.collaboration.reviewChanges)]
      ]
    );
    printSection("Interface");
    printKeyValue([
      ["theme", settings.theme],
      ["accent", settings.accent],
      ["telemetry", "disabled (always)"],
      ["database", store.path]
    ]);
    console.log("");
    console.log(dim(`Set a value with ${bold("comicode settings set <path> <value>")}.`));
    console.log(dim(`Available paths: ${SETTING_PATHS.join(", ")}`));
  });
}
async function getSetting(path, options) {
  await withStore(({ store }) => {
    const settings = store.getSettings();
    const value = getPath(settings, path);
    if (value === void 0) {
      throw new Error(`Unknown setting path "${path}". Run "comicode settings" to list paths.`);
    }
    if (options.json) jsonOut({ path, value });
    else console.log(`${path} = ${formatValue(value)}`);
  });
}
async function setSetting(path, rawValue) {
  const allowed = SETTING_PATHS;
  if (!allowed.includes(path)) {
    throw new Error(`Unknown setting path "${path}". Available paths:
  ${allowed.join("\n  ")}`);
  }
  await withStore(({ store }) => {
    let value = parseSettingValue(rawValue);
    if (path.endsWith("ProfileId")) {
      if (value === null || value === "") {
        value = null;
      } else if (typeof value === "string") {
        const profile = resolveProfile(store, value);
        value = profile.id;
      }
    }
    const current = store.getSettings();
    const candidate = JSON.parse(JSON.stringify(current));
    setPath(candidate, path, value);
    let validated;
    try {
      validated = parseSettings(candidate);
    } catch (error) {
      throw new Error(
        `Invalid value for ${path}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    store.saveSettings(validated);
    console.log(`${success("\u2714")} ${path} = ${formatValue(getPath(validated, path))}`);
    if (path === "routing.allowPaid" && validated.routing.allowPaid) {
      console.log(
        warning(
          "Paid fallbacks are now allowed. Explicit selections were always honored; use --allow-paid for a one-run override."
        )
      );
    }
  });
}
async function resetSettings(options) {
  await withStore(async ({ store }) => {
    if (!options.yes) {
      if (!isInteractive())
        throw new Error("Resetting settings requires --yes in non-interactive mode.");
      const confirmed = await promptConfirm(
        "Reset all settings to defaults? Task history is preserved.",
        false
      );
      if (!confirmed) {
        console.log(dim("Cancelled."));
        return;
      }
    }
    store.saveSettings(DEFAULT_SETTINGS);
    console.log(`${success("\u2714")} Settings reset to defaults.`);
  });
}
async function exportConfig(file) {
  await withStore(({ store }) => {
    const bundle = {
      version: 1,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      settings: store.getSettings(),
      profiles: exportProviders(store).profiles
    };
    const text = `${JSON.stringify(bundle, null, 2)}
`;
    if (file) {
      const path = resolve5(process.cwd(), file);
      writeFileSync4(path, text, "utf8");
      console.log(`${success("\u2714")} Exported configuration to ${path}.`);
      console.log(dim("Credentials are never included. API keys must be re-added after import."));
    } else {
      process.stdout.write(text);
    }
  });
}
async function importConfig(file) {
  const path = resolve5(process.cwd(), file);
  if (!existsSync8(path)) throw new Error(`File not found: ${path}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync11(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  await withStore(({ store }) => {
    const record = parsed && typeof parsed === "object" ? parsed : {};
    if (record.settings) {
      store.saveSettings(parseSettings(record.settings));
      console.log(`${success("\u2714")} Imported settings.`);
    }
    if (record.profiles) {
      const summary = importProviders(store, {
        version: 1,
        profiles: record.profiles
      });
      console.log(
        `${success("\u2714")} Imported profiles: ${summary.created} created, ${summary.updated} updated, ${summary.skipped} skipped.`
      );
      for (const item of summary.warnings) console.log(`${warning("!")} ${item}`);
    }
    if (!record.settings && !record.profiles) {
      throw new Error("This file does not contain settings or profiles.");
    }
    console.log(dim('Re-add API keys with "comicode auth set <profile>".'));
  });
}
function registerSettingsCommands(program) {
  const settings = program.command("settings").description("Show and change routing, agent, and interface settings").option("--json", "machine-readable output").action(async (options) => {
    await showSettings(options);
  });
  settings.command("list").description("Show all settings").option("--json", "machine-readable output").action(async (options) => {
    await showSettings(options);
  });
  settings.command("get <path>").description("Read one setting").option("--json", "machine-readable output").action(async (path, options) => {
    await getSetting(path, options);
  });
  settings.command("set <path> <value>").description("Set one setting").action(async (path, value) => {
    await setSetting(path, value);
  });
  settings.command("reset").description("Reset settings to defaults").option("--yes", "do not prompt for confirmation").action(async (options) => {
    await resetSettings(options);
  });
  const config = program.command("config").description("Export or import configuration (never credentials)");
  config.command("export [file]").description("Export settings and provider profiles").action(async (file) => {
    await exportConfig(file);
  });
  config.command("import <file>").description("Import settings and provider profiles").action(async (file) => {
    await importConfig(file);
  });
  config.command("path").description("Show the ComiCode data directory").action(() => {
    console.log(getComicodeHome());
  });
  config.command("show").description("Show the active configuration").action(async () => {
    await showSettings({ json: true });
  });
  void danger;
}
var init_settings2 = __esm({
  "src/cli/commands/settings.ts"() {
    "use strict";
    init_settings();
    init_service();
    init_paths();
    init_output();
    init_prompt();
    init_shared();
  }
});

// src/core/project/init.ts
import { existsSync as existsSync9, mkdirSync as mkdirSync7, readFileSync as readFileSync12, writeFileSync as writeFileSync5 } from "fs";
import { basename as basename4, join as join12 } from "path";
function readProjectConfig(cwd) {
  const path = getProjectStatePath(cwd);
  if (!existsSync9(path)) return null;
  try {
    return JSON.parse(readFileSync12(path, "utf8"));
  } catch {
    return null;
  }
}
async function initProject(cwd, requestedName) {
  const directory = getProjectStateDir(cwd);
  mkdirSync7(directory, { recursive: true });
  const inspector = new ProjectInspector(cwd);
  const existing = readProjectConfig(cwd);
  const commands = inspector.detectCommands();
  const config = existing ?? {
    schemaVersion: 1,
    name: requestedName?.trim() || inspector.projectName() || basename4(cwd),
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    commands: {
      test: commands.test,
      lint: commands.lint,
      build: commands.build,
      dev: commands.dev
    }
  };
  if (requestedName?.trim()) config.name = requestedName.trim();
  config.commands = {
    test: commands.test,
    lint: commands.lint,
    build: commands.build,
    dev: commands.dev
  };
  const configPath = getProjectStatePath(cwd);
  writeFileSync5(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  let gitignoreUpdated = false;
  const gitignore = join12(cwd, ".gitignore");
  const marker = ".comicode/";
  try {
    const current = existsSync9(gitignore) ? readFileSync12(gitignore, "utf8") : "";
    const hasMarker = current.split(/\r?\n/).some((line) => line.trim() === marker || line.trim() === ".comicode");
    if (!hasMarker) {
      const prefix = current && !current.endsWith("\n") ? "\n" : "";
      const block = `${prefix}
# ComiCode project state (contains task metadata, never credentials)
${marker}
`;
      writeFileSync5(gitignore, current + block, "utf8");
      gitignoreUpdated = true;
    }
  } catch {
  }
  return {
    config,
    created: !existing,
    gitignoreUpdated,
    configPath
  };
}
var init_init = __esm({
  "src/core/project/init.ts"() {
    "use strict";
    init_paths();
    init_inspector();
  }
});

// src/cli/commands/system.ts
import { existsSync as existsSync10, statSync as statSync9 } from "fs";
function compareVersions(left, right) {
  const a = left.split(".").map((part) => Number(part.replace(/\D/g, "")) || 0);
  const b = right.split(".").map((part) => Number(part.replace(/\D/g, "")) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
async function initCommand(name, options) {
  const cwd = process.cwd();
  const result = await initProject(cwd, name);
  await withStore(({ store }) => {
    void store.stats();
  });
  if (options.json) {
    jsonOut(result);
    return;
  }
  printSection(result.created ? "Project initialized" : "Project configuration updated");
  printKeyValue([
    ["Project", result.config.name],
    ["Config", result.configPath],
    [".gitignore", result.gitignoreUpdated ? success("updated") : dim("already configured")],
    ["Test command", result.config.commands.test ?? dim("(none detected)")],
    ["Lint command", result.config.commands.lint ?? dim("(none detected)")],
    ["Build command", result.config.commands.build ?? dim("(none detected)")]
  ]);
  console.log("");
  console.log(
    dim(
      "The .comicode directory contains local task metadata and is ignored by git. It never stores credentials."
    )
  );
  console.log(
    `Next: ${bold("comicode providers add")} then ${bold("comicode")} or ${bold('comicode run "<task>"')}.`
  );
  if (existsSync10(getDatabasePath())) {
    console.log(dim(`Database: ${getDatabasePath()} (${statSync9(getDatabasePath()).size} bytes)`));
  }
}
async function credentialState(profile) {
  if (profile.apiKeyEnv) {
    return process.env[profile.apiKeyEnv] ? success(`env:${profile.apiKeyEnv}`) : warning(`env:${profile.apiKeyEnv} (unset)`);
  }
  if (profile.config?.allowNoAuth === true) return dim("no auth");
  const ids = new Set(getCredentialStore().listSecretIds());
  return ids.has(credentialIdForProfile(profile.id)) ? success("stored") : warning("missing");
}
async function authStatus(options) {
  await withStore(async ({ store }) => {
    const backend = await getCredentialStore().describe();
    const profiles = store.listProfiles();
    const rows = await Promise.all(
      profiles.map(async (profile) => ({
        name: profile.name,
        provider: providerDisplayName(profile.providerId),
        state: await credentialState(profile),
        env: profile.apiKeyEnv
      }))
    );
    if (options.json) {
      jsonOut({ backend, profiles: rows });
      return;
    }
    printSection("Credentials");
    printKeyValue([
      ["Backend", `${backend.label}${backend.secure ? "" : dim(" (fallback)")}`],
      ["Detail", backend.detail],
      ["Storage", getComicodeHome()]
    ]);
    printSection("Profile credentials");
    printTable(
      ["PROFILE", "PROVIDER", "CREDENTIAL"],
      rows.map((row) => [row.name, row.provider, row.state])
    );
    if (profiles.length === 0) {
      console.log(dim('No profiles yet. Add one with "comicode providers add".'));
    }
    console.log("");
    console.log(
      dim(
        "Secrets are stored through the OS credential facility when available, otherwise AES-256-GCM."
      )
    );
  });
}
async function authSet(reference, options) {
  await withStore(async ({ store }) => {
    const profile = resolveProfile(store, reference);
    let key = options.key?.trim() ?? "";
    if (!key) {
      if (!isInteractive()) {
        throw new Error(
          "Provide --key in non-interactive mode, or set an environment variable with --api-key-env."
        );
      }
      key = (await promptSecret(
        `API key(s) for ${profile.name}, comma-separated for multiple (input is hidden)`
      )).trim();
    }
    const keys = parseKeyInput(key);
    if (keys.length === 0) throw new Error("The API key cannot be empty.");
    for (const entry of keys) registerSecret(entry);
    await getCredentialStore().setSecret(credentialIdForProfile(profile.id), keysToSecret(keys));
    store.updateProfile(profile.id, { apiKeyEnv: null, lastError: null, lastErrorAt: null });
    store.clearLimitsForProfile(profile.id);
    console.log(
      `${success("\u2714")} Stored ${keys.length} API key${keys.length === 1 ? "" : "s"} for ${profile.name}.`
    );
    if (options.test) {
      const fresh = store.getProfile(profile.id);
      if (fresh) {
        const result = await testProfileConnection(store, fresh);
        console.log(
          result.ok ? `${success("\u2714")} ${result.message} ${dim(`(${result.latencyMs}ms)`)}` : `${danger("\u2716")} ${result.message} (${result.category ?? "unknown"})`
        );
        if (!result.ok) process.exitCode = 1;
      }
    }
  });
}
async function authRemove(reference) {
  await withStore(async ({ store }) => {
    const profile = resolveProfile(store, reference);
    await getCredentialStore().deleteSecret(credentialIdForProfile(profile.id));
    console.log(`${success("\u2714")} Removed the stored credential for ${profile.name}.`);
  });
}
async function authBackend(options) {
  const backend = await getCredentialStore().describe();
  if (options.json) {
    jsonOut(backend);
    return;
  }
  printKeyValue([
    ["Backend", backend.label],
    ["Secure", backend.secure ? success("yes") : warning("fallback")],
    ["Detail", backend.detail],
    ["Secrets indexed", String(getCredentialStore().listSecretIds().length)]
  ]);
}
async function doctor(options) {
  return withStore(async ({ store, cwd }) => {
    const warnings = [];
    const errors = [];
    const stats = store.stats();
    const backend = await getCredentialStore().describe();
    const git = await runProcess("git", ["--version"], { timeoutMs: 8e3, maxOutputBytes: 2e3 });
    const nodeOk = compareVersions(process.version.replace(/^v/, ""), "22.5.0") >= 0;
    if (!nodeOk) errors.push("Node.js 22.5 or newer is required for node:sqlite.");
    if (!backend.secure) {
      warnings.push(
        "Credentials use the encrypted-file fallback. Keep the ComiCode data directory private."
      );
    }
    const profiles = store.listProfiles();
    if (profiles.length === 0) warnings.push("No provider profiles are connected.");
    const selectedProfile = store.getSelectedProfileId();
    const selectedModel = store.getSelectedModelId();
    if (profiles.length > 0 && !selectedProfile) warnings.push("No profile is selected.");
    if (profiles.length > 0 && !selectedModel) {
      warnings.push("No model is selected; the router will use the first enabled profile default.");
    }
    const enabledWithoutModel = profiles.filter(
      (profile) => profile.enabled && !profile.defaultModel
    );
    for (const profile of enabledWithoutModel) {
      warnings.push(`Profile "${profile.name}" has no default model.`);
    }
    const activeLimits = store.listLimits(true);
    if (activeLimits.length) {
      warnings.push(
        `${activeLimits.length} provider limit${activeLimits.length === 1 ? "" : "s"} active.`
      );
    }
    const project = readProjectConfig(cwd);
    if (!project) warnings.push('Project state is not initialized. Run "comicode init".');
    const modelCounts = /* @__PURE__ */ new Map();
    for (const model of store.listModels()) {
      modelCounts.set(model.providerId, (modelCounts.get(model.providerId) ?? 0) + 1);
    }
    const results = [];
    if (options.test) {
      for (const profile of profiles.filter((entry) => entry.enabled)) {
        const result = await testProfileConnection(store, profile);
        results.push({
          profile: profile.name,
          ok: result.ok,
          message: result.message,
          latencyMs: result.latencyMs
        });
        if (!result.ok) warnings.push(`${profile.name}: ${result.message}`);
      }
    }
    if (options.json) {
      jsonOut({
        version: VERSION,
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        home: getComicodeHome(),
        database: getDatabasePath(),
        stats,
        credentialBackend: backend,
        git: git.spawnError ? null : git.stdout.trim(),
        project,
        selectedProfile,
        selectedModel,
        profiles: profiles.map((profile) => ({
          name: profile.name,
          provider: profile.providerId,
          enabled: profile.enabled,
          defaultModel: profile.defaultModel,
          lastError: profile.lastError
        })),
        activeLimits,
        tests: results.length ? results : void 0,
        warnings,
        errors
      });
      return errors.length ? 1 : 0;
    }
    printSection("ComiCode doctor");
    printKeyValue([
      ["Version", VERSION],
      ["Node", `${process.version}${nodeOk ? "" : danger(" (too old)")}`],
      ["Platform", `${process.platform} ${process.arch}`],
      ["Home", getComicodeHome()],
      ["Database", `${stats.databasePath} (${(stats.databaseBytes / 1024).toFixed(1)} KiB)`],
      ["Credential backend", `${backend.label}${backend.secure ? "" : warning(" (fallback)")}`],
      ["Git", git.spawnError ? danger("not found") : git.stdout.trim()],
      ["Project config", project ? success(project.name) : warning("not initialized")],
      ["Profiles", String(stats.profiles)],
      ["Models", String(stats.models)],
      ["Tasks", `${stats.tasks} total, ${stats.pausedTasks} paused`]
    ]);
    printSection("Profiles");
    if (profiles.length === 0) {
      console.log(dim("None connected."));
    } else {
      printTable(
        ["PROFILE", "PROVIDER", "ENABLED", "DEFAULT MODEL", "CREDENTIAL", "LAST ERROR"],
        await Promise.all(
          profiles.map(async (profile) => [
            profile.name,
            providerDisplayName(profile.providerId),
            profile.enabled ? success("yes") : warning("no"),
            profile.defaultModel ?? "\u2014",
            await credentialState(profile),
            truncate(profile.lastError ?? "\u2014", 40)
          ])
        )
      );
    }
    if (results.length) {
      printSection("Connection tests");
      printTable(
        ["PROFILE", "RESULT", "LATENCY", "MESSAGE"],
        results.map((result) => [
          result.profile,
          result.ok ? success("ok") : danger("failed"),
          `${result.latencyMs}ms`,
          truncate(result.message, 60)
        ])
      );
    }
    if (activeLimits.length) {
      printSection("Active limits");
      for (const limit of activeLimits) {
        const profile = store.getProfile(limit.profileId);
        console.log(
          `  ${profile?.name ?? limit.profileId} / ${limit.modelId}: ${describeCategory(limit.category)} ${limit.resetAt || limit.retryAfterAt ? `(reset ${formatDateTime(limit.resetAt ?? limit.retryAfterAt)})` : "(reset unknown)"}`
        );
      }
    }
    if (warnings.length) {
      printSection("Warnings");
      for (const item of warnings) console.log(`${warning("!")} ${item}`);
    }
    if (errors.length) {
      printSection("Errors");
      for (const item of errors) console.log(`${danger("\u2716")} ${item}`);
    }
    if (!warnings.length && !errors.length) {
      console.log("");
      console.log(`${success("\u2714")} Everything looks healthy.`);
    }
    console.log("");
    console.log(dim(`Logs: ${getComicodeHome()}\\logs\\comicode.log \xB7 No telemetry is collected.`));
    return errors.length ? 1 : 0;
  });
}
async function dataStats(options) {
  await withStore(({ store }) => {
    const stats = store.stats();
    if (options.json) {
      jsonOut(stats);
      return;
    }
    printKeyValue([
      ["Database", stats.databasePath],
      ["Size", `${(stats.databaseBytes / 1024).toFixed(1)} KiB`],
      ["Profiles", String(stats.profiles)],
      ["Models", String(stats.models)],
      ["Tasks", String(stats.tasks)],
      ["Paused tasks", String(stats.pausedTasks)]
    ]);
  });
}
async function dataDeleteAll(options) {
  await withStore(async ({ store }) => {
    if (!options.yes) {
      if (!isInteractive()) {
        throw new Error("Deleting all ComiCode data requires --yes in non-interactive mode.");
      }
      const answer = await promptText(
        "This deletes profiles, credentials, tasks, checkpoints, models, usage, and settings. Type DELETE to confirm:",
        { required: true }
      );
      if (answer !== "DELETE") {
        console.log(dim("Cancelled."));
        return;
      }
    }
    await getCredentialStore().deleteAllSecrets();
    store.deleteAllData();
    console.log(`${success("\u2714")} All ComiCode data and stored credentials were deleted.`);
    console.log(dim("Project .comicode directories and log files were left untouched."));
  });
}
async function dataVacuum() {
  await withStore(({ store }) => {
    store.db.raw.exec("VACUUM");
    console.log(`${success("\u2714")} Database vacuumed.`);
  });
}
function registerSystemCommands(program) {
  program.command("init [name]").description("Initialize ComiCode state for the current project").option("--json", "machine-readable output").action(async (name, options) => {
    await initCommand(name, options);
  });
  const auth = program.command("auth").description("Manage credentials without exposing them");
  auth.command("status").description("Show credential backend and per-profile status").option("--json", "machine-readable output").action(async (options) => {
    await authStatus(options);
  });
  auth.command("set [profile]").description("Store an API key securely for a profile").option("--key <key>", "API key (prefer interactive input)").option("--test", "test the connection after storing the key").action(async (reference, options) => {
    await authSet(reference, options);
  });
  auth.command("remove [profile]").alias("delete").description("Remove a stored API key").action(async (reference) => {
    await authRemove(reference);
  });
  auth.command("backend").description("Show the active credential storage backend").option("--json", "machine-readable output").action(async (options) => {
    await authBackend(options);
  });
  program.command("doctor").description("Diagnose installation, storage, providers, and project state").option("--test", "test all enabled provider connections").option("--json", "machine-readable output").action(async (options) => {
    const code = await doctor(options);
    if (code !== 0) process.exitCode = code;
  });
  const data = program.command("data").description("Inspect or delete local ComiCode data");
  data.command("stats").description("Show database statistics").option("--json", "machine-readable output").action(async (options) => {
    await dataStats(options);
  });
  data.command("vacuum").description("Compact the SQLite database").action(async () => {
    await dataVacuum();
  });
  data.command("delete-all").description("Delete all ComiCode data and credentials (keeps logs and .comicode folders)").option("--yes", "do not prompt for confirmation").action(async (options) => {
    await dataDeleteAll(options);
  });
  program.command("version").description("Print the ComiCode version").action(() => {
    console.log(VERSION);
    console.log(dim("Data directory: " + getComicodeHome()));
    void formatRelative;
  });
  program.command("update").description("Check for a newer ComiCode release and install it globally").option("--check", "only report whether an update is available").action(async (options) => {
    const repo = GITHUB_REPOSITORY.replace("https://github.com/", "");
    let latest = null;
    let latestRef = null;
    let reachable = false;
    try {
      const npmResponse = await fetch("https://registry.npmjs.org/comicode/latest", {
        signal: AbortSignal.timeout(1e4)
      });
      if (npmResponse.ok) {
        reachable = true;
        const body = await npmResponse.json();
        if (body.version) latest = body.version;
      }
    } catch {
    }
    if (!latest) {
      for (const url of [
        `https://api.github.com/repos/${repo}/releases/latest`,
        `https://api.github.com/repos/${repo}/tags?per_page=1`
      ]) {
        try {
          const response = await fetch(url, {
            headers: {
              "User-Agent": "comicode",
              Accept: "application/vnd.github+json"
            },
            signal: AbortSignal.timeout(1e4)
          });
          if (response.status === 404) {
            reachable = true;
            continue;
          }
          if (!response.ok) continue;
          reachable = true;
          const body = await response.json();
          const tag = Array.isArray(body) ? body[0]?.name : body.tag_name;
          if (tag) {
            latestRef = tag;
            latest = tag.replace(/^v/, "");
            break;
          }
        } catch {
        }
      }
    }
    if (!reachable) {
      console.log(warning("Could not reach the update server to check for updates."));
      return;
    }
    if (!latest) {
      console.log(dim(`No published releases found yet \u2014 ${VERSION} is as new as it gets.`));
      return;
    }
    if (compareVersions(VERSION, latest) >= 0) {
      console.log(success(`ComiCode ${VERSION} is up to date (latest release: ${latest}).`));
      return;
    }
    console.log(`${warning("Update available")}: ${VERSION} \u2192 ${bold(latest)}`);
    if (options.check) {
      console.log(dim(`Run ${bold("comicode update")} to install it.`));
      return;
    }
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const specs = latestRef ? [`github:${repo}#${latestRef}`, `github:${repo}`] : [`comicode@${latest}`, `github:${repo}`];
    let installed = false;
    for (const spec of specs) {
      console.log(dim(`Installing ${spec} \u2026`));
      const result = await runProcess(npmCmd, ["install", "-g", spec], {
        timeoutMs: 6e5
      });
      if (result.code === 0) {
        installed = true;
        break;
      }
      const tail = result.stderr.trim().split("\n").slice(-3).join("\n");
      if (tail) console.log(dim(tail));
    }
    if (installed) {
      console.log(success(`Updated to ${latest}. Restart ComiCode to use the new version.`));
    } else {
      console.log(danger(`Update failed. Run manually: npm install -g github:${repo}`));
    }
  });
}
var init_system = __esm({
  "src/cli/commands/system.ts"() {
    "use strict";
    init_service();
    init_errors();
    init_definitions();
    init_credentials();
    init_redact();
    init_paths();
    init_init();
    init_process();
    init_version();
    init_output();
    init_prompt();
    init_shared();
  }
});

// src/core/bench.ts
var bench_exports = {};
__export(bench_exports, {
  runBenchmarks: () => runBenchmarks
});
import { performance } from "perf_hooks";
import { statSync as statSync10 } from "fs";
function mb(bytes) {
  return Math.round(bytes / 1024 / 1024 * 100) / 100;
}
async function runBenchmarks(cwd, iterations = 5) {
  const results = [];
  const time = async (label, fn) => {
    await fn();
    const samples = [];
    for (let i = 0; i < iterations; i += 1) {
      const start = performance.now();
      await fn();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    results.push({
      metric: label,
      value: Math.round((samples[Math.floor(samples.length / 2)] ?? 0) * 100) / 100,
      unit: "ms"
    });
  };
  let context = null;
  await time("startup.openContext", () => {
    context?.close();
    context = openAppContext(cwd);
  });
  const opened = context;
  if (opened) {
    const mem = process.memoryUsage();
    results.push({ metric: "memory.heapAfterOpen", value: mb(mem.heapUsed), unit: "MB" });
    results.push({ metric: "memory.rssAfterOpen", value: mb(mem.rss), unit: "MB" });
    try {
      results.push({
        metric: "storage.databaseSize",
        value: mb(statSync10(opened.store.path).size),
        unit: "MB"
      });
    } catch {
    }
  }
  const inspector = new ProjectInspector(cwd);
  await time("inspect.project", async () => {
    await inspector.snapshot();
  });
  await time("skills.load", () => {
    loadSkills(cwd);
  });
  const skills = loadSkills(cwd);
  const history2 = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `Sample message ${i} with some representative content about the codebase.`
  }));
  const builder = new ContextBuilder();
  const input = {
    task: { ...BENCH_TASK, projectPath: cwd },
    model: BENCH_MODEL,
    history: history2,
    settings: DEFAULT_SETTINGS,
    inspector,
    relevantFiles: [],
    cache: {},
    skills,
    mode: "build"
  };
  await time("context.build", () => {
    builder.build(input);
  });
  const built = builder.build(input);
  results.push({
    metric: "context.estimatedTokens",
    value: estimateTokens(built.system + built.contextText),
    unit: "tokens"
  });
  context?.close();
  return results;
}
var BENCH_MODEL, BENCH_TASK;
var init_bench = __esm({
  "src/core/bench.ts"() {
    "use strict";
    init_app();
    init_context();
    init_skills();
    init_inspector();
    init_settings();
    BENCH_MODEL = {
      id: "bench",
      providerId: "custom",
      profileId: null,
      modelId: "bench-model",
      displayName: "bench",
      contextWindow: 128e3,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      codingSuitability: 5,
      reasoningSuitability: 5,
      inputPricePerMillion: null,
      outputPricePerMillion: null,
      access: "unknown",
      accessSource: "bench",
      accessNotes: null,
      available: true,
      lastCheckedAt: null,
      userClassification: null,
      metadata: {}
    };
    BENCH_TASK = {
      id: "bench",
      projectPath: "",
      projectName: "bench",
      userRequest: "Implement a benchmark harness for the agent context engine.",
      taskType: "coding",
      status: "active",
      phase: "inspect",
      plan: null,
      completedSteps: [],
      pendingSteps: [],
      relevantFiles: [],
      changedFiles: [],
      currentProfileId: null,
      currentModelId: null,
      attempts: [],
      metadata: {},
      summary: null,
      error: null,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      completedAt: null,
      resumeCount: 0,
      lastCheckpointId: null
    };
  }
});

// src/tui/theme.ts
function setActiveTheme(name) {
  activeTheme = name && name in THEMES ? name : "obsidian";
}
var obsidian, nord, forest, ocean, ember, mono, lavender, paper, daylight, sepia, blossom, slate, contrast, THEMES, THEME_NAMES, THEME_LABELS, activeTheme, theme, glyph;
var init_theme = __esm({
  "src/tui/theme.ts"() {
    "use strict";
    obsidian = {
      bg: "#0B0E14",
      surface: "#111722",
      surfaceAlt: "#171E2B",
      border: "#232B3A",
      borderStrong: "#334155",
      accent: "#7CE8C3",
      accentDim: "#2F6F5E",
      text: "#E6EAF2",
      muted: "#8A94A6",
      faint: "#566176",
      warm: "#E9B872",
      danger: "#FF7A85",
      warning: "#F2C14E",
      info: "#7FB8FF",
      violet: "#B49CFF",
      success: "#7CE8C3",
      black: "#0B0E14",
      white: "#F7F9FC"
    };
    nord = {
      bg: "#242933",
      surface: "#2E3440",
      surfaceAlt: "#3B4252",
      border: "#3B4252",
      borderStrong: "#4C566A",
      accent: "#88C0D0",
      accentDim: "#4C7A8A",
      text: "#ECEFF4",
      muted: "#9AA5B1",
      faint: "#616E88",
      warm: "#EBCB8B",
      danger: "#BF616A",
      warning: "#EBCB8B",
      info: "#81A1C1",
      violet: "#B48EAD",
      success: "#A3BE8C",
      black: "#242933",
      white: "#ECEFF4"
    };
    forest = {
      bg: "#0C1512",
      surface: "#122019",
      surfaceAlt: "#182A22",
      border: "#1F352B",
      borderStrong: "#2E4A3C",
      accent: "#7FD8A4",
      accentDim: "#2E6B4C",
      text: "#E4F2EA",
      muted: "#8FA99B",
      faint: "#57705F",
      warm: "#E5C07B",
      danger: "#FF7A85",
      warning: "#E5C07B",
      info: "#7FB8FF",
      violet: "#B49CFF",
      success: "#7FD8A4",
      black: "#0C1512",
      white: "#F2FAF5"
    };
    ocean = {
      bg: "#0A1420",
      surface: "#0F1E30",
      surfaceAlt: "#16293F",
      border: "#1B3350",
      borderStrong: "#274263",
      accent: "#6CC7FF",
      accentDim: "#2C5F8F",
      text: "#E3F0FA",
      muted: "#8CA3BC",
      faint: "#546C85",
      warm: "#FFC978",
      danger: "#FF7A85",
      warning: "#FFC978",
      info: "#8FD0FF",
      violet: "#B49CFF",
      success: "#6CC7FF",
      black: "#0A1420",
      white: "#F0F8FF"
    };
    ember = {
      bg: "#150E0B",
      surface: "#1F1512",
      surfaceAlt: "#2A1D18",
      border: "#3A2A22",
      borderStrong: "#54402F",
      accent: "#FFAB6B",
      accentDim: "#8F5426",
      text: "#F5EAE2",
      muted: "#B08F7E",
      faint: "#6E5546",
      warm: "#FFD08A",
      danger: "#FF7A85",
      warning: "#FFD08A",
      info: "#8FCBFF",
      violet: "#D0B3FF",
      success: "#FFAB6B",
      black: "#150E0B",
      white: "#FFF6EF"
    };
    mono = {
      bg: "#0E0E10",
      surface: "#161618",
      surfaceAlt: "#1E1E22",
      border: "#2A2A30",
      borderStrong: "#3D3D45",
      accent: "#D6D6DE",
      accentDim: "#6E6E78",
      text: "#EDEDF2",
      muted: "#9C9CA8",
      faint: "#61616C",
      warm: "#E8E8EE",
      danger: "#FF8080",
      warning: "#E8D27A",
      info: "#9EC2FF",
      violet: "#C8B8FF",
      success: "#B8E6B0",
      black: "#0E0E10",
      white: "#FAFAFC"
    };
    lavender = {
      bg: "#120E1C",
      surface: "#1A1428",
      surfaceAlt: "#241B36",
      border: "#322A48",
      borderStrong: "#463B63",
      accent: "#C9A8F0",
      accentDim: "#6B4E96",
      text: "#EFE9F8",
      muted: "#A89CC0",
      faint: "#6E628A",
      warm: "#F0C9A0",
      danger: "#FF8FA3",
      warning: "#F0D08A",
      info: "#9CC4FF",
      violet: "#E0C8FF",
      success: "#B5E3C0",
      black: "#120E1C",
      white: "#F6F1FC"
    };
    paper = {
      bg: "#F6F3EC",
      surface: "#FFFFFF",
      surfaceAlt: "#EFEAE0",
      border: "#D9D2C4",
      borderStrong: "#BDB4A2",
      accent: "#1F5FD0",
      accentDim: "#9DB8E8",
      text: "#1E2430",
      muted: "#5A6474",
      faint: "#8B93A3",
      warm: "#A05A1E",
      danger: "#C22E3A",
      warning: "#8A6A12",
      info: "#0E6FA8",
      violet: "#6B3FB5",
      success: "#1E7A46",
      black: "#FFFFFF",
      white: "#1E2430"
    };
    daylight = {
      bg: "#EEF3F9",
      surface: "#FFFFFF",
      surfaceAlt: "#E4ECF5",
      border: "#CBD8E8",
      borderStrong: "#A9BCD6",
      accent: "#0B62C4",
      accentDim: "#8FB4E0",
      text: "#152238",
      muted: "#4F5F75",
      faint: "#8494A9",
      warm: "#9A5B12",
      danger: "#B91C2C",
      warning: "#8A6108",
      info: "#0369A1",
      violet: "#6D3FC0",
      success: "#15803D",
      black: "#FFFFFF",
      white: "#152238"
    };
    sepia = {
      bg: "#F1E7D5",
      surface: "#F8F1E3",
      surfaceAlt: "#EAE0CB",
      border: "#D8C9AE",
      borderStrong: "#BFAE8C",
      accent: "#8A4B12",
      accentDim: "#C9A06B",
      text: "#33291D",
      muted: "#6E5F4B",
      faint: "#9B8B72",
      warm: "#7A4410",
      danger: "#A02C22",
      warning: "#7A5A10",
      info: "#2F5E8A",
      violet: "#6B3E86",
      success: "#3E6B2F",
      black: "#FFFFFF",
      white: "#33291D"
    };
    blossom = {
      bg: "#FDF1F4",
      surface: "#FFFFFF",
      surfaceAlt: "#F9E4EA",
      border: "#F0CFD9",
      borderStrong: "#E0A9BC",
      accent: "#C2185B",
      accentDim: "#E8A3BC",
      text: "#33161F",
      muted: "#7A4A58",
      faint: "#A98A94",
      warm: "#9A4A1E",
      danger: "#B91C2C",
      warning: "#8A6108",
      info: "#0E6FA8",
      violet: "#7C3AED",
      success: "#15803D",
      black: "#FFFFFF",
      white: "#33161F"
    };
    slate = {
      bg: "#E9EDF2",
      surface: "#F4F6F9",
      surfaceAlt: "#DFE5EC",
      border: "#C3CDDA",
      borderStrong: "#A3B1C4",
      accent: "#1D4ED8",
      accentDim: "#A9BEE8",
      text: "#1B2430",
      muted: "#4A586C",
      faint: "#7C8AA0",
      warm: "#92580E",
      danger: "#B91C2C",
      warning: "#85600A",
      info: "#0369A1",
      violet: "#6D3FC0",
      success: "#15803D",
      black: "#FFFFFF",
      white: "#1B2430"
    };
    contrast = {
      bg: "#000000",
      surface: "#0A0A0A",
      surfaceAlt: "#141414",
      border: "#3A3A3A",
      borderStrong: "#5C5C5C",
      accent: "#FFD400",
      accentDim: "#8A7500",
      text: "#FFFFFF",
      muted: "#C8C8C8",
      faint: "#8A8A8A",
      warm: "#FFB84D",
      danger: "#FF5C5C",
      warning: "#FFD400",
      info: "#6FB7FF",
      violet: "#D9B8FF",
      success: "#7DFF9B",
      black: "#000000",
      white: "#FFFFFF"
    };
    THEMES = {
      obsidian,
      nord,
      forest,
      ocean,
      ember,
      mono,
      lavender,
      paper,
      daylight,
      sepia,
      blossom,
      slate,
      contrast
    };
    THEME_NAMES = Object.keys(THEMES);
    THEME_LABELS = {
      obsidian: "Obsidian (dark)",
      nord: "Nord",
      forest: "Forest",
      ocean: "Ocean",
      ember: "Ember",
      mono: "Mono",
      lavender: "Lavender",
      paper: "Paper (light)",
      daylight: "Daylight (light)",
      sepia: "Sepia (light)",
      blossom: "Blossom (light)",
      slate: "Slate (light)",
      contrast: "High contrast"
    };
    activeTheme = "obsidian";
    theme = new Proxy({}, {
      get: (_target, prop) => THEMES[activeTheme][prop]
    });
    glyph = {
      brand: "\u25C8",
      prompt: "\u276F",
      active: "\u25B8",
      bullet: "\xB7",
      tool: "\u2699",
      route: "\u21E2",
      check: "\u2714",
      cross: "\u2716",
      pause: "\u2161",
      dot: "\u25CF",
      ring: "\u25CB",
      arrowUp: "\u2191",
      arrowDown: "\u2193",
      arrowLeft: "\u2190",
      arrowRight: "\u2192",
      rule: "\u2500"
    };
  }
});

// src/tui/mouse.ts
function setMouseClickHandler(handler) {
  clickHandler = handler;
}
function isMouseSequence(input) {
  return input.startsWith("\x1B[<");
}
function isSuppressedInput() {
  return Date.now() < suppressUntil;
}
function disableMouseTracking() {
  if (!process.stdout.isTTY) return;
  process.stdout.write(DISABLE_MOUSE);
}
function enableAlternateScroll() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return () => {
  };
  process.stdout.write("\x1B[?1007h");
  return () => {
    process.stdout.write("\x1B[?1007l");
  };
}
function enableMouseWheel(handler) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return () => {
  };
  wheelHandler = handler;
  if (!listening) {
    listening = true;
    onData = (chunk) => {
      const text = chunk.toString("utf8");
      if (!text.includes("\x1B[<")) return;
      suppressUntil = Date.now() + 120;
      SGR_MOUSE.lastIndex = 0;
      let match;
      while ((match = SGR_MOUSE.exec(text)) !== null) {
        const code = Number.parseInt(match[1] ?? "0", 10);
        const col = Number.parseInt(match[2] ?? "0", 10);
        const row = Number.parseInt(match[3] ?? "0", 10);
        const release = match[4] === "m";
        if (code === 64) wheelHandler?.(-1);
        else if (code === 65) wheelHandler?.(1);
        else if (!release && (code & 3) === 0 && (code & 32) === 0) {
          clickHandler?.(row, col);
        }
      }
    };
    process.stdin.on("data", onData);
    process.stdout.write(`${DISABLE_MOUSE}${ENABLE_WHEEL}`);
  }
  return () => {
    wheelHandler = null;
    if (!listening) return;
    listening = false;
    if (onData) process.stdin.off("data", onData);
    onData = null;
    disableMouseTracking();
  };
}
var SGR_MOUSE, DISABLE_MOUSE, ENABLE_WHEEL, listening, suppressUntil, wheelHandler, clickHandler, onData;
var init_mouse = __esm({
  "src/tui/mouse.ts"() {
    "use strict";
    SGR_MOUSE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
    DISABLE_MOUSE = "\x1B[?1000l\x1B[?1002l\x1B[?1003l\x1B[?1005l\x1B[?1006l\x1B[?1015l";
    ENABLE_WHEEL = "\x1B[?1000h\x1B[?1006h";
    listening = false;
    suppressUntil = 0;
    wheelHandler = null;
    clickHandler = null;
    onData = null;
  }
});

// src/tui/components.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import { jsx, jsxs } from "react/jsx-runtime";
function wrapText(text, width) {
  const chars = Array.from(text);
  const lines = [];
  let i = 0;
  while (i < chars.length) {
    let end = Math.min(i + width, chars.length);
    if (end < chars.length) {
      let spaceBreak = -1;
      for (let j = end; j > i + 1; j -= 1) {
        if (/\s/.test(chars[j - 1] ?? "")) {
          spaceBreak = j - 1;
          break;
        }
      }
      if (spaceBreak > i) end = spaceBreak;
    }
    const raw = chars.slice(i, end);
    let trimEnd = raw.length;
    while (trimEnd > 0 && /\s/.test(raw[trimEnd - 1] ?? "")) trimEnd -= 1;
    lines.push({ text: raw.slice(0, trimEnd).join(""), start: i });
    i = end;
    while (i < chars.length && /\s/.test(chars[i] ?? "")) i += 1;
  }
  return lines.length > 0 ? lines : [{ text: "", start: 0 }];
}
function isEnter(input, key) {
  return key.return || input === "\n" || input === "\r";
}
function useLayout() {
  const size = useWindowSize();
  const columns = Math.max(40, size.columns || 80);
  const rows = Math.max(12, size.rows || 30);
  return {
    columns,
    rows,
    compact: columns < 92,
    contentWidth: Math.max(30, columns - 2)
  };
}
function Divider({ width }) {
  return /* @__PURE__ */ jsx(Text, { color: theme.border, children: glyph.rule.repeat(Math.max(1, width)) });
}
function StatusPill({ status }) {
  const value = STATUS[status];
  const dot = status === "running" ? glyph.dot : status === "completed" ? glyph.check : glyph.ring;
  return /* @__PURE__ */ jsxs(Text, { color: value.color, children: [
    dot,
    " ",
    value.label
  ] });
}
function Header({
  version,
  cwd,
  profileName,
  status,
  allowPaid,
  taskId,
  branch,
  columns,
  dimmed,
  agentMode = "build"
}) {
  const compact = columns < 96;
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", flexShrink: 0, paddingX: 1, children: [
    /* @__PURE__ */ jsxs(Box, { justifyContent: "space-between", children: [
      /* @__PURE__ */ jsxs(Text, { wrap: "truncate", dimColor: dimmed, children: [
        /* @__PURE__ */ jsx(Text, { bold: true, color: theme.accent, children: glyph.brand }),
        /* @__PURE__ */ jsxs(Text, { bold: true, color: theme.text, children: [
          " ",
          "comicode"
        ] }),
        /* @__PURE__ */ jsxs(Text, { color: theme.faint, children: [
          " workspace v",
          version
        ] })
      ] }),
      /* @__PURE__ */ jsxs(Box, { columnGap: 2, children: [
        allowPaid ? /* @__PURE__ */ jsx(Text, { color: theme.warning, dimColor: dimmed, children: "paid on" }) : null,
        /* @__PURE__ */ jsx(StatusPill, { status }),
        !compact ? /* @__PURE__ */ jsx(Text, { color: theme.faint, dimColor: dimmed, children: "ctrl+p commands" }) : null
      ] })
    ] }),
    /* @__PURE__ */ jsxs(Box, { marginTop: 1, justifyContent: "space-between", width: "100%", children: [
      /* @__PURE__ */ jsxs(Box, { columnGap: 2, children: [
        /* @__PURE__ */ jsxs(Text, { dimColor: dimmed, children: [
          /* @__PURE__ */ jsx(Text, { color: theme.faint, children: "ctrl+b " }),
          /* @__PURE__ */ jsx(
            Text,
            {
              color: profileName ? theme.text : theme.warning,
              bold: true,
              backgroundColor: theme.border,
              children: profileName ? ` ${glyph.ring} ${profileName} ` : " Connect Provider "
            }
          )
        ] }),
        /* @__PURE__ */ jsxs(Text, { dimColor: dimmed, children: [
          /* @__PURE__ */ jsx(Text, { color: theme.faint, children: "ctrl+m " }),
          /* @__PURE__ */ jsx(Text, { color: theme.accent, bold: true, backgroundColor: theme.border, children: " Change model " })
        ] }),
        /* @__PURE__ */ jsxs(Text, { dimColor: dimmed, children: [
          /* @__PURE__ */ jsx(Text, { color: theme.faint, children: "tab " }),
          /* @__PURE__ */ jsxs(
            Text,
            {
              color: agentMode === "build" ? theme.text : theme.warning,
              bold: true,
              backgroundColor: theme.border,
              children: [
                " ",
                agentMode === "build" ? glyph.tool : agentMode === "plan" ? glyph.pause : glyph.ring,
                " ",
                agentMode,
                " "
              ]
            }
          )
        ] })
      ] }),
      taskId ? /* @__PURE__ */ jsxs(Text, { color: theme.faint, dimColor: dimmed, children: [
        "task ",
        taskId.slice(0, 8)
      ] }) : null
    ] }),
    /* @__PURE__ */ jsxs(Box, { justifyContent: "space-between", marginTop: 1, children: [
      /* @__PURE__ */ jsxs(Text, { color: theme.muted, wrap: "truncate-middle", dimColor: dimmed, children: [
        cwd,
        branch ? /* @__PURE__ */ jsxs(Text, { color: theme.violet, children: [
          " \u2387 ",
          branch
        ] }) : null
      ] }),
      !compact ? /* @__PURE__ */ jsx(Text, { color: theme.faint, dimColor: dimmed, children: "/ commands \xB7 ? shortcuts" }) : null
    ] }),
    /* @__PURE__ */ jsx(Box, { children: /* @__PURE__ */ jsx(Divider, { width: Math.max(1, columns - 2) }) })
  ] });
}
function Footer({
  hints,
  toast,
  width
}) {
  const failed = toast ? /fail|error|cannot|not |missing|blocked/i.test(toast) : false;
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", flexShrink: 0, paddingX: 1, children: [
    /* @__PURE__ */ jsx(Divider, { width: Math.max(1, width - 2) }),
    /* @__PURE__ */ jsx(Box, { justifyContent: "space-between", children: /* @__PURE__ */ jsx(Text, { color: toast ? failed ? theme.danger : theme.success : theme.faint, wrap: "truncate", children: toast ?? hints.join(`  ${glyph.bullet}  `) }) })
  ] });
}
function PanelScreen({
  title,
  subtitle,
  children,
  accent: accent2 = theme.accent
}) {
  return /* @__PURE__ */ jsxs(
    Box,
    {
      flexDirection: "column",
      height: "100%",
      borderStyle: "round",
      borderColor: theme.border,
      paddingX: 1,
      overflow: "hidden",
      children: [
        /* @__PURE__ */ jsxs(Box, { justifyContent: "space-between", flexShrink: 0, children: [
          /* @__PURE__ */ jsxs(Text, { bold: true, color: theme.text, children: [
            /* @__PURE__ */ jsxs(Text, { color: accent2, children: [
              glyph.brand,
              " "
            ] }),
            title
          ] }),
          subtitle ? /* @__PURE__ */ jsx(Text, { color: theme.muted, children: subtitle }) : null
        ] }),
        /* @__PURE__ */ jsx(Box, { flexDirection: "column", flexGrow: 1, overflow: "hidden", marginTop: 1, children })
      ]
    }
  );
}
function Hint({ children }) {
  return /* @__PURE__ */ jsx(Text, { color: theme.faint, children });
}
function Empty({ children }) {
  return /* @__PURE__ */ jsx(Box, { paddingY: 1, paddingLeft: 1, children: /* @__PURE__ */ jsx(Text, { color: theme.muted, wrap: "wrap", children }) });
}
function KeyValue({
  rows,
  width = 22
}) {
  return /* @__PURE__ */ jsx(Box, { flexDirection: "column", children: rows.map(([key, value]) => /* @__PURE__ */ jsxs(Box, { children: [
    /* @__PURE__ */ jsx(Box, { width, children: /* @__PURE__ */ jsx(Text, { color: theme.faint, children: key }) }),
    /* @__PURE__ */ jsx(Box, { flexGrow: 1, children: /* @__PURE__ */ jsx(Text, { wrap: "truncate-end", children: value }) })
  ] }, key)) });
}
function Spinner({ frame, label }) {
  const frames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  return /* @__PURE__ */ jsxs(Text, { children: [
    /* @__PURE__ */ jsx(Text, { color: theme.accent, children: frames[frame % frames.length] }),
    /* @__PURE__ */ jsxs(Text, { color: theme.text, children: [
      " ",
      label
    ] })
  ] });
}
function formatCount(value) {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(value);
}
function clip(text, max = 120) {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}\u2026` : single;
}
function clipLines(text, maxLines = 4, maxChars = 900) {
  const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}\u2026` : text;
  const lines = clipped.split(/\r?\n/);
  if (lines.length <= maxLines) return clipped;
  return `${lines.slice(0, maxLines).join("\n")}
[+${lines.length - maxLines} lines]`;
}
function normalizeInsertion(input) {
  const flattened = input.replace(/\r\n?/g, " ").replace(/\n/g, " ");
  return Array.from(flattened).filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 32 && code !== 127;
  }).join("");
}
function PromptInput({
  value,
  onChange,
  onSubmit,
  focus = true,
  placeholder = "",
  mask,
  suggestions = [],
  history: history2 = [],
  onCycleScreen,
  onCycleMode,
  prompt,
  promptColor = theme.accent,
  maxSuggestions = 8,
  popupTitle = "COMMANDS"
}) {
  const chars = useMemo(() => Array.from(value), [value]);
  const [cursor, setCursor] = useState(chars.length);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [suggestionActive, setSuggestionActive] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(null);
  const draftRef = useRef("");
  useEffect(() => {
    setCursor((current) => Math.min(current, chars.length));
  }, [chars.length]);
  useEffect(() => {
    setSuggestionDismissed(false);
    setSuggestionIndex(0);
  }, [value]);
  useEffect(() => {
    if (suggestionIndex >= suggestions.length) setSuggestionIndex(0);
  }, [suggestionIndex, suggestions.length]);
  const visibleSuggestions = suggestions.slice(0, maxSuggestions);
  const mentionMode = /(^|\s)@([^\s@]*)$/.test(value);
  const labelWidth = Math.min(
    28,
    Math.max(10, ...visibleSuggestions.map((suggestion) => suggestion.label.length))
  );
  const resetAfterSubmit = () => {
    setCursor(0);
    setSuggestionIndex(0);
    setSuggestionActive(false);
    setSuggestionDismissed(false);
    setHistoryIndex(null);
    draftRef.current = "";
  };
  const completeSuggestion = (suggestion) => {
    const next = suggestion.submit ? suggestion.value : suggestion.value.endsWith(" ") ? suggestion.value : `${suggestion.value} `;
    onChange(next);
    setCursor(Array.from(next).length);
    setSuggestionIndex(0);
    setSuggestionActive(false);
    setHistoryIndex(null);
  };
  const recallHistory = (direction) => {
    if (history2.length === 0) return;
    if (historyIndex === null) {
      if (direction === 1) return;
      draftRef.current = value;
      const index = history2.length - 1;
      setHistoryIndex(index);
      onChange(history2[index] ?? "");
      setCursor(Array.from(history2[index] ?? "").length);
      return;
    }
    const next = historyIndex + direction;
    if (next < 0) {
      setHistoryIndex(0);
      onChange(history2[0] ?? "");
      setCursor(Array.from(history2[0] ?? "").length);
      return;
    }
    if (next >= history2.length) {
      setHistoryIndex(null);
      onChange(draftRef.current);
      setCursor(Array.from(draftRef.current).length);
      return;
    }
    setHistoryIndex(next);
    onChange(history2[next] ?? "");
    setCursor(Array.from(history2[next] ?? "").length);
  };
  useInput(
    (input, key) => {
      if (isMouseSequence(input) || isSuppressedInput()) return;
      const enter = isEnter(input, key);
      const isSuggestionOpen = visibleSuggestions.length > 0 && !suggestionDismissed && historyIndex === null && (suggestionActive || value.startsWith("/") || mentionMode);
      if (key.escape) {
        if (isSuggestionOpen) {
          setSuggestionDismissed(true);
          setSuggestionActive(false);
          return;
        }
        return;
      }
      if (enter) {
        if (isSuggestionOpen) {
          const suggestion = visibleSuggestions[Math.min(suggestionIndex, visibleSuggestions.length - 1)];
          if (suggestion.submit) {
            onSubmit(suggestion.value);
            resetAfterSubmit();
          } else {
            completeSuggestion(suggestion);
          }
          return;
        }
        onSubmit(value);
        resetAfterSubmit();
        return;
      }
      if (key.tab) {
        if (isSuggestionOpen) {
          const suggestion = visibleSuggestions[suggestionIndex % visibleSuggestions.length] ?? visibleSuggestions[0];
          completeSuggestion(suggestion);
          return;
        }
        if (onCycleMode) onCycleMode(key.shift ? -1 : 1);
        else onCycleScreen?.(key.shift ? -1 : 1);
        return;
      }
      if (key.upArrow || key.downArrow) {
        if (isSuggestionOpen) {
          setSuggestionDismissed(false);
          setSuggestionActive(true);
          setSuggestionIndex((current) => {
            return key.upArrow ? (current - 1 + visibleSuggestions.length) % visibleSuggestions.length : (current + 1) % visibleSuggestions.length;
          });
          return;
        }
        recallHistory(key.upArrow ? -1 : 1);
        return;
      }
      if (key.leftArrow) {
        if (key.ctrl || key.meta) {
          onCycleScreen?.(-1);
          return;
        }
        if (cursor > 0) setCursor(cursor - 1);
        else if (chars.length === 0) onCycleScreen?.(-1);
        return;
      }
      if (key.rightArrow) {
        if (key.ctrl || key.meta) {
          onCycleScreen?.(1);
          return;
        }
        if (cursor < chars.length) setCursor(cursor + 1);
        else if (chars.length === 0) onCycleScreen?.(1);
        return;
      }
      if (key.home || key.ctrl && input === "a") {
        setCursor(0);
        return;
      }
      if (key.end || key.ctrl && input === "e") {
        setCursor(chars.length);
        return;
      }
      if (key.ctrl) {
        if (input === "u") {
          onChange("");
          setCursor(0);
          setHistoryIndex(null);
        } else if (input === "w") {
          let next2 = cursor;
          while (next2 > 0 && /\s/.test(chars[next2 - 1] ?? "")) next2 -= 1;
          while (next2 > 0 && !/\s/.test(chars[next2 - 1] ?? "")) next2 -= 1;
          onChange([...chars.slice(0, next2), ...chars.slice(cursor)].join(""));
          setCursor(next2);
          setHistoryIndex(null);
        } else if (input === "h") {
          if (cursor > 0) {
            onChange([...chars.slice(0, cursor - 1), ...chars.slice(cursor)].join(""));
            setCursor(cursor - 1);
            setHistoryIndex(null);
          }
        }
        return;
      }
      if (key.meta) return;
      if (key.backspace) {
        if (cursor > 0) {
          onChange([...chars.slice(0, cursor - 1), ...chars.slice(cursor)].join(""));
          setCursor(cursor - 1);
          setHistoryIndex(null);
          setSuggestionActive(false);
        }
        return;
      }
      if (key.delete) {
        if (cursor < chars.length) {
          onChange([...chars.slice(0, cursor), ...chars.slice(cursor + 1)].join(""));
          setHistoryIndex(null);
          setSuggestionActive(false);
        }
        return;
      }
      if (key.pageUp || key.pageDown || input.length === 0) return;
      const clean = normalizeInsertion(input);
      if (!clean) return;
      const inserted = Array.from(clean);
      const next = [...chars.slice(0, cursor), ...inserted, ...chars.slice(cursor)].join("");
      onChange(next);
      setCursor(cursor + inserted.length);
      setHistoryIndex(null);
      setSuggestionActive(false);
    },
    { isActive: focus }
  );
  const displayChars = mask ? Array.from(mask.repeat(chars.length)) : chars;
  const { columns, rows } = useLayout();
  const renderedChars = [
    ...displayChars.slice(0, cursor),
    displayChars[cursor] ?? " ",
    ...displayChars.slice(cursor + 1)
  ];
  const inputWidth = Math.max(16, columns - 12);
  const wrapped = wrapText(renderedChars.join(""), inputWidth);
  const maxLines = Math.min(10, Math.max(4, Math.floor(rows / 3)));
  let cursorLine = wrapped.length - 1;
  for (let index = 0; index < wrapped.length; index += 1) {
    const nextStart = wrapped[index + 1]?.start ?? Number.MAX_SAFE_INTEGER;
    if (cursor >= wrapped[index].start && cursor < nextStart) {
      cursorLine = index;
      break;
    }
  }
  const firstLine = Math.max(
    0,
    Math.min(cursorLine - Math.floor(maxLines / 2), wrapped.length - maxLines)
  );
  const lastLine = Math.min(wrapped.length, firstLine + maxLines);
  const showCursor = focus && (chars.length > 0 || placeholder.length === 0);
  const placeholderFirst = placeholder.slice(0, 1);
  const placeholderRest = placeholder.slice(1);
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
    focus && visibleSuggestions.length > 0 && !suggestionDismissed && historyIndex === null && (suggestionActive || value.startsWith("/") || mentionMode) ? /* @__PURE__ */ jsxs(
      Box,
      {
        flexDirection: "column",
        borderStyle: "round",
        borderColor: theme.accent,
        backgroundColor: theme.surface,
        paddingX: 1,
        marginBottom: 1,
        children: [
          /* @__PURE__ */ jsxs(Box, { justifyContent: "space-between", marginBottom: 1, children: [
            /* @__PURE__ */ jsxs(Text, { color: theme.accent, bold: true, children: [
              glyph.brand,
              " ",
              mentionMode ? "FILES" : popupTitle
            ] }),
            /* @__PURE__ */ jsx(Text, { color: theme.faint, children: mentionMode ? "\u2191/\u2193 choose \xB7 tab/enter insert \xB7 esc dismiss" : "\u2191/\u2193 choose \xB7 enter run \xB7 tab complete \xB7 esc dismiss" })
          ] }),
          visibleSuggestions.map((suggestion, index) => {
            const selected = index === suggestionIndex;
            return /* @__PURE__ */ jsxs(
              Box,
              {
                justifyContent: "space-between",
                backgroundColor: selected ? theme.surfaceAlt : void 0,
                children: [
                  /* @__PURE__ */ jsxs(Box, { children: [
                    /* @__PURE__ */ jsxs(Text, { color: selected ? theme.accent : theme.text, bold: selected, children: [
                      selected ? `${glyph.active} ` : "  ",
                      suggestion.label.padEnd(labelWidth)
                    ] }),
                    suggestion.detail ? /* @__PURE__ */ jsxs(Text, { color: selected ? theme.text : theme.muted, children: [
                      " ",
                      suggestion.detail
                    ] }) : null
                  ] }),
                  suggestion.hint ? /* @__PURE__ */ jsx(Text, { color: selected ? theme.text : theme.faint, children: suggestion.hint }) : null
                ]
              },
              `${suggestion.value}-${index}`
            );
          })
        ]
      }
    ) : null,
    /* @__PURE__ */ jsxs(Box, { children: [
      /* @__PURE__ */ jsx(Text, { color: promptColor, bold: true, children: prompt ?? `${glyph.prompt} ` }),
      /* @__PURE__ */ jsx(Box, { flexGrow: 1, children: chars.length === 0 && placeholder ? focus ? /* @__PURE__ */ jsxs(Text, { color: theme.faint, wrap: "wrap", children: [
        /* @__PURE__ */ jsx(Text, { color: theme.muted, inverse: true, children: placeholderFirst }),
        placeholderRest
      ] }) : /* @__PURE__ */ jsx(Text, { color: theme.faint, wrap: "wrap", children: placeholder }) : /* @__PURE__ */ jsxs(Box, { flexDirection: "column", flexGrow: 1, children: [
        firstLine > 0 ? /* @__PURE__ */ jsx(Text, { color: theme.faint, children: "\u22EE" }) : null,
        wrapped.slice(firstLine, lastLine).map((line, lineIndex) => {
          const absolute = firstLine + lineIndex;
          if (!showCursor || absolute !== cursorLine) {
            return /* @__PURE__ */ jsx(Text, { color: theme.text, wrap: "truncate", children: line.text || " " }, absolute);
          }
          const lineChars = Array.from(line.text);
          const col = Math.min(cursor - line.start, lineChars.length);
          const cursorChar = lineChars[col] ?? " ";
          return /* @__PURE__ */ jsxs(Text, { color: theme.text, wrap: "truncate", children: [
            lineChars.slice(0, col).join(""),
            /* @__PURE__ */ jsx(Text, { inverse: true, children: cursorChar }),
            lineChars.slice(col + 1).join("")
          ] }, absolute);
        }),
        lastLine < wrapped.length ? /* @__PURE__ */ jsx(Text, { color: theme.faint, children: "\u22EE" }) : null
      ] }) })
    ] })
  ] });
}
var STATUS;
var init_components = __esm({
  "src/tui/components.tsx"() {
    "use strict";
    init_theme();
    init_mouse();
    STATUS = {
      idle: { color: theme.faint, label: "idle" },
      running: { color: theme.accent, label: "running" },
      paused: { color: theme.warning, label: "paused" },
      completed: { color: theme.success, label: "completed" },
      failed: { color: theme.danger, label: "failed" }
    };
  }
});

// src/tui/dialogs/confirm-dialog.tsx
import { useEffect as useEffect2, useRef as useRef2, useState as useState2 } from "react";
import { Box as Box2, Text as Text2, useInput as useInput2, useWindowSize as useWindowSize2 } from "ink";
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function ConfirmDialog({
  request,
  onDecision
}) {
  const canAlways = ALWAYS_KINDS.has(request.kind);
  const options = [
    { label: "Allow once", hint: "approve this action", decision: "allow", shortcut: "y" },
    ...canAlways ? [
      {
        label: "Always allow",
        hint: "approve and remember for this run",
        decision: "always",
        shortcut: "a"
      }
    ] : [],
    { label: "Deny", hint: "refuse this action", decision: "deny", shortcut: "n" }
  ];
  const [selected, setSelected] = useState2(0);
  const { rows } = useWindowSize2();
  const optionsRef = useRef2(options);
  optionsRef.current = options;
  useEffect2(() => {
    setMouseClickHandler((row) => {
      const list = optionsRef.current;
      const firstOptionRow = rows - list.length - 7;
      const index = row - firstOptionRow;
      if (index >= 0 && index < list.length) {
        onDecision(list[index].decision);
      }
    });
    return () => setMouseClickHandler(null);
  }, [rows, onDecision]);
  useInput2((input, key) => {
    const char = input.toLowerCase();
    if (char === "y") return onDecision("allow");
    if (canAlways && char === "a") return onDecision("always");
    if (char === "n" || key.escape) return onDecision("deny");
    if (key.upArrow) {
      setSelected((value) => (value - 1 + options.length) % options.length);
      return;
    }
    if (key.downArrow) {
      setSelected((value) => (value + 1) % options.length);
      return;
    }
    if (key.return || input === " ") {
      const option = options[selected];
      if (option) onDecision(option.decision);
    }
  });
  const diffLines = request.diff ? request.diff.split(/\r?\n/).slice(0, 4) : [];
  const diffTotal = request.diff ? request.diff.split(/\r?\n/).length : 0;
  const target = request.command ?? request.path ?? null;
  return /* @__PURE__ */ jsxs2(
    Box2,
    {
      flexDirection: "column",
      flexShrink: 0,
      borderStyle: "round",
      borderColor: theme.warning,
      backgroundColor: theme.surface,
      paddingX: 1,
      children: [
        /* @__PURE__ */ jsxs2(Text2, { color: theme.warning, bold: true, wrap: "truncate", children: [
          glyph.pause,
          " ",
          request.title
        ] }),
        /* @__PURE__ */ jsx2(Text2, { color: theme.muted, wrap: "truncate", children: clip(request.description, 120) }),
        target ? /* @__PURE__ */ jsxs2(Text2, { color: theme.warning, wrap: "truncate-middle", children: [
          request.command ? "$ " : "",
          clip(target, 100)
        ] }) : null,
        request.reasons?.slice(0, 2).map((reason) => /* @__PURE__ */ jsxs2(Text2, { color: theme.danger, wrap: "truncate", children: [
          glyph.bullet,
          " ",
          clip(reason, 100)
        ] }, reason)),
        diffLines.length ? /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", children: [
          diffLines.map((line, index) => /* @__PURE__ */ jsx2(
            Text2,
            {
              color: line.startsWith("+") ? theme.success : line.startsWith("-") ? theme.danger : theme.muted,
              wrap: "truncate",
              children: clip(line, 100) || " "
            },
            `${index}-${line.slice(0, 10)}`
          )),
          diffTotal > diffLines.length ? /* @__PURE__ */ jsxs2(Text2, { color: theme.faint, children: [
            "[+",
            diffTotal - diffLines.length,
            " diff lines]"
          ] }) : null
        ] }) : null,
        /* @__PURE__ */ jsx2(Box2, { flexDirection: "column", marginTop: 1, children: options.map((option, index) => {
          const active = index === selected;
          const color = option.decision === "deny" ? theme.danger : theme.success;
          return /* @__PURE__ */ jsxs2(Box2, { children: [
            /* @__PURE__ */ jsx2(Text2, { color: active ? theme.accent : theme.faint, bold: active, children: active ? `${glyph.active} ` : "  " }),
            /* @__PURE__ */ jsx2(Text2, { color: active ? color : theme.muted, bold: active, children: option.label }),
            /* @__PURE__ */ jsxs2(Text2, { color: theme.faint, children: [
              " \u2014 ",
              option.hint
            ] }),
            /* @__PURE__ */ jsxs2(Text2, { color: theme.faint, children: [
              " [",
              option.shortcut,
              "]"
            ] })
          ] }, option.decision);
        }) }),
        /* @__PURE__ */ jsx2(Text2, { color: theme.faint, wrap: "truncate", children: "\u2191/\u2193 choose \xB7 enter/click select \xB7 esc deny" })
      ]
    }
  );
}
var ALWAYS_KINDS;
var init_confirm_dialog = __esm({
  "src/tui/dialogs/confirm-dialog.tsx"() {
    "use strict";
    init_theme();
    init_components();
    init_mouse();
    ALWAYS_KINDS = /* @__PURE__ */ new Set([
      "file-write",
      "file-delete",
      "command",
      "dangerous-command",
      "provider-switch",
      "ui-verify"
    ]);
  }
});

// src/tui/dialogs/modal.tsx
import { createContext, useContext } from "react";
import { Box as Box3, Text as Text3 } from "ink";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function ModalWindow({
  title,
  subtitle,
  width = 72,
  height = 20,
  borderColor = theme.accent,
  footer = ["\u2191\u2193 navigate", "enter select", "esc close"],
  children
}) {
  const { columns, rows } = useLayout();
  const modalWidth = Math.max(36, Math.min(columns - 4, width));
  const modalHeight = Math.max(8, Math.min(rows - 4, height));
  return /* @__PURE__ */ jsx3(
    Box3,
    {
      position: "absolute",
      top: 0,
      left: 0,
      width: columns,
      height: rows,
      justifyContent: "center",
      alignItems: "center",
      children: /* @__PURE__ */ jsxs3(
        Box3,
        {
          width: modalWidth,
          height: modalHeight,
          borderStyle: "round",
          borderColor,
          backgroundColor: theme.surface,
          flexDirection: "column",
          overflow: "hidden",
          paddingX: 1,
          children: [
            title ? /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", flexShrink: 0, marginBottom: 1, children: [
              /* @__PURE__ */ jsxs3(Text3, { bold: true, color: theme.text, wrap: "truncate", children: [
                /* @__PURE__ */ jsxs3(Text3, { color: borderColor, children: [
                  glyph.brand,
                  " "
                ] }),
                title
              ] }),
              subtitle ? /* @__PURE__ */ jsx3(Text3, { color: theme.faint, wrap: "truncate", children: subtitle }) : null
            ] }) : null,
            /* @__PURE__ */ jsx3(Box3, { flexDirection: "column", flexGrow: 1, overflow: "hidden", children }),
            footer && footer.length > 0 ? /* @__PURE__ */ jsx3(Box3, { flexShrink: 0, marginTop: 1, justifyContent: "space-between", children: /* @__PURE__ */ jsx3(Text3, { color: theme.faint, wrap: "truncate", children: footer.join(`  ${glyph.bullet}  `) }) }) : null
          ]
        }
      )
    }
  );
}
var ModalContext;
var init_modal = __esm({
  "src/tui/dialogs/modal.tsx"() {
    "use strict";
    init_theme();
    init_components();
    ModalContext = createContext({
      activeModal: null,
      modalStack: [],
      openModal: () => {
      },
      closeModal: () => {
      },
      replaceModal: () => {
      },
      closeAllModals: () => {
      }
    });
  }
});

// src/core/commands/catalog.ts
function slashCommandSpecs() {
  return COMMAND_SPECS.filter((spec) => spec.surfaces.includes("slash"));
}
function commandReferenceLines() {
  const lines = [];
  let category = null;
  for (const spec of slashCommandSpecs()) {
    if (spec.category !== category) {
      category = spec.category;
      if (lines.length) lines.push("");
      lines.push(category.toUpperCase());
    }
    const usage2 = spec.usage ?? `/${spec.id}`;
    const aliases = spec.aliases?.length ? ` (${spec.aliases.map((alias) => `/${alias}`).join(", ")})` : "";
    const shortcut = spec.shortcut ? ` [${spec.shortcut}]` : "";
    lines.push(`  ${usage2.padEnd(24)} ${spec.summary}${aliases}${shortcut}`);
  }
  return lines;
}
var COMMAND_SPECS, byId;
var init_catalog2 = __esm({
  "src/core/commands/catalog.ts"() {
    "use strict";
    COMMAND_SPECS = [
      {
        id: "help",
        summary: "Show commands and shortcuts",
        description: "List every command, argument, alias, and keyboard shortcut.",
        usage: "/help",
        aliases: ["?"],
        category: "system",
        surfaces: ["slash"]
      },
      {
        id: "model",
        summary: "Select an AI model",
        description: "Open the searchable model picker, or select a model directly by id/name. Updates the active model used by new work.",
        usage: "/model [model]",
        arguments: [{ name: "model", description: "Model id, name, or unique substring" }],
        category: "providers",
        surfaces: ["slash"],
        shortcut: "ctrl+m"
      },
      {
        id: "models",
        summary: "Browse the model catalog",
        description: "Open the full model catalog with filters, metadata, and manual entries.",
        usage: "/models",
        category: "providers",
        surfaces: ["slash", "cli"],
        shortcut: "ctrl+g"
      },
      {
        id: "connect",
        summary: "Connect a provider",
        description: "Choose a provider and add a profile with a name, API key, base URL, and optional model. Supports multiple profiles per provider.",
        usage: "/connect",
        category: "providers",
        surfaces: ["slash", "cli"]
      },
      {
        id: "providers",
        summary: "Manage connected providers",
        description: "List profiles, add or edit profiles, enable/disable, test connections, refresh models, and remove credentials.",
        usage: "/providers",
        category: "providers",
        surfaces: ["slash", "cli"]
      },
      {
        id: "status",
        summary: "View provider, quota, and task status",
        description: "Show the selected profile/model, connection state, active rate limits and quota classes, routing history, and git status.",
        usage: "/status",
        category: "providers",
        surfaces: ["slash", "cli"]
      },
      {
        id: "usage",
        summary: "View token usage and limits",
        description: "Show token totals, per-model usage, cost estimates, and active provider limits.",
        usage: "/usage",
        category: "providers",
        surfaces: ["slash", "cli"]
      },
      {
        id: "tasks",
        summary: "Manage tasks and sessions",
        description: "Search tasks, inspect progress, resume paused work, rename tasks, delete history, or start a new task.",
        usage: "/tasks",
        aliases: ["sessions"],
        category: "tasks",
        surfaces: ["slash", "cli"],
        shortcut: "ctrl+t"
      },
      {
        id: "resume",
        summary: "Resume a task",
        description: "Resume the current task or choose a paused/interrupted task. Progress, checkpoints, and git state are preserved.",
        usage: "/resume [task-id]",
        arguments: [{ name: "task-id", description: "Task id or unique prefix" }],
        category: "tasks",
        surfaces: ["slash", "cli"]
      },
      {
        id: "clear",
        summary: "Clear the conversation view",
        description: "Clear the on-screen transcript without deleting stored task history.",
        usage: "/clear",
        category: "context",
        surfaces: ["slash"],
        shortcut: "ctrl+l"
      },
      {
        id: "compact",
        summary: "Compact the conversation context",
        description: "Summarize earlier turns while preserving the request, plan, decisions, tool activity, and changed files. The summary remains inspectable.",
        usage: "/compact",
        category: "context",
        surfaces: ["slash"]
      },
      {
        id: "settings",
        summary: "Open settings",
        description: "Review and change routing, safety, and editor preferences.",
        usage: "/settings",
        category: "system",
        surfaces: ["slash", "cli"]
      },
      {
        id: "undo",
        summary: "Safely undo task changes",
        description: "Restore files changed by the current task from its baseline snapshot. Refuses files modified after ComiCode finished and never touches unrelated files.",
        usage: "/undo",
        category: "git",
        surfaces: ["slash"]
      },
      {
        id: "diff",
        summary: "View changes made by this task",
        description: "Show the git diff for files changed by the current task, including untracked files.",
        usage: "/diff",
        category: "git",
        surfaces: ["slash"]
      },
      {
        id: "shortcuts",
        summary: "Show keyboard shortcuts",
        description: "List global, workspace, and dialog keyboard shortcuts.",
        usage: "/shortcuts",
        category: "system",
        surfaces: ["slash"],
        shortcut: "?"
      },
      {
        id: "new",
        summary: "Start a fresh task",
        description: "Clear the active task and transcript so the next request starts a new task.",
        usage: "/new",
        aliases: ["reset"],
        category: "tasks",
        surfaces: ["slash"],
        shortcut: "ctrl+n"
      },
      {
        id: "delete",
        summary: "Delete a task and its history",
        description: "Delete the active task, or a saved task by id/prefix. Removes its messages and checkpoints after confirmation.",
        usage: "/delete [task-id]",
        arguments: [
          {
            name: "task-id",
            description: "Task id or unique prefix (default: the active task)",
            required: false
          }
        ],
        category: "tasks",
        surfaces: ["slash"]
      },
      {
        id: "profile",
        summary: "Reasoning effort / provider profile",
        description: "Open the effort picker (low/medium/default/high/xhigh) or switch the active provider profile by name.",
        usage: "/profile [name]",
        arguments: [
          {
            name: "name",
            description: "Profile name, id, or provider:name (omit to pick effort)",
            required: false
          }
        ],
        category: "providers",
        surfaces: ["slash"]
      },
      {
        id: "storage",
        summary: "Inspect storage usage",
        description: "Show database size and row counts per table.",
        usage: "/storage",
        category: "system",
        surfaces: ["slash"]
      },
      {
        id: "cleanup",
        summary: "Clean up old tasks",
        description: "Delete completed/failed tasks older than the retention period and vacuum the database.",
        usage: "/cleanup [days]",
        arguments: [
          {
            name: "days",
            description: "Retention window in days (default: settings storage.retentionDays)",
            required: false
          }
        ],
        category: "system",
        surfaces: ["slash"]
      },
      {
        id: "copy",
        summary: "Copy output to clipboard",
        description: "Copy the most recent assistant or tool output, or the full transcript with /copy all, to the system clipboard.",
        usage: "/copy [all]",
        arguments: [
          {
            name: "scope",
            description: 'omit for the last output, or "all" for the full transcript',
            required: false,
            values: ["all"]
          }
        ],
        category: "context",
        surfaces: ["slash"]
      },
      {
        id: "allow-paid",
        summary: "Allow or block paid fallbacks",
        description: "Control whether routing may fall back to paid models.",
        usage: "/allow-paid on|off",
        arguments: [
          {
            name: "state",
            description: "on or off",
            required: true,
            values: ["on", "off"]
          }
        ],
        category: "providers",
        surfaces: ["slash"]
      },
      {
        id: "mode",
        summary: "Switch the agent mode",
        description: "Choose how the agent behaves: auto (classify), build, plan, debug, architect, review, refactor, test, docs, design, security, or explain. Tab also cycles modes.",
        usage: "/mode [mode]",
        aliases: ["agent"],
        arguments: [
          {
            name: "mode",
            description: "agent mode",
            values: [
              "auto",
              "build",
              "plan",
              "debug",
              "architect",
              "review",
              "refactor",
              "test",
              "docs",
              "design",
              "security",
              "explain"
            ]
          }
        ],
        category: "agent",
        surfaces: ["slash"],
        shortcut: "tab"
      },
      {
        id: "skills",
        summary: "List available agent skills",
        description: "Show built-in, user, and project skills the agent can load with the use_skill tool.",
        usage: "/skills",
        category: "agent",
        surfaces: ["slash"]
      },
      {
        id: "tools",
        summary: "Expand or collapse tool output",
        description: "Toggle detailed tool arguments, output, errors, and durations in the transcript.",
        usage: "/tools",
        category: "agent",
        surfaces: ["slash"],
        shortcut: "ctrl+o"
      },
      {
        id: "workspace",
        summary: "Return to the workspace",
        description: "Navigate back to the main conversation workspace.",
        usage: "/workspace",
        aliases: ["home"],
        category: "navigation",
        surfaces: ["slash"]
      },
      {
        id: "exit",
        summary: "Quit ComiCode",
        description: "Close the terminal UI cleanly.",
        usage: "/exit",
        aliases: ["quit"],
        category: "system",
        surfaces: ["slash"]
      },
      {
        id: "init",
        summary: "Initialize project state",
        description: "Create or update the project configuration in the current directory.",
        usage: "comicode init",
        category: "system",
        surfaces: ["cli"]
      },
      {
        id: "task",
        summary: "Run a coding task",
        description: "Start a coding task from the command line.",
        usage: 'comicode task "<request>"',
        category: "agent",
        surfaces: ["cli"]
      },
      {
        id: "doctor",
        summary: "Diagnose the installation",
        description: "Check runtime, storage, credentials, providers, project state, and git.",
        usage: "comicode doctor",
        category: "system",
        surfaces: ["cli"]
      },
      {
        id: "version",
        summary: "Print the version",
        description: "Print the ComiCode version and data directory.",
        usage: "comicode --version",
        category: "system",
        surfaces: ["cli"]
      }
    ];
    byId = new Map(COMMAND_SPECS.map((spec) => [spec.id, spec]));
  }
});

// src/core/clipboard.ts
var clipboard_exports = {};
__export(clipboard_exports, {
  copyToClipboard: () => copyToClipboard
});
import { execFile as execFile2 } from "child_process";
async function copyToClipboard(text) {
  if (!text) return false;
  const { platform } = process;
  const command = platform === "win32" ? "clip" : platform === "darwin" ? "pbcopy" : "xclip";
  const args = platform === "linux" ? ["-selection", "clipboard"] : [];
  return new Promise((resolve6) => {
    const child = execFile2(command, args, { timeout: 5e3 }, (error) => {
      resolve6(!error);
    });
    child.stdin?.on("error", () => resolve6(false));
    child.stdin?.end(text);
  });
}
var init_clipboard = __esm({
  "src/core/clipboard.ts"() {
    "use strict";
  }
});

// src/tui/commands/registry.ts
var CommandRegistry, commandRegistry;
var init_registry2 = __esm({
  "src/tui/commands/registry.ts"() {
    "use strict";
    init_catalog2();
    init_shared();
    init_compaction();
    init_modes();
    init_skills();
    init_theme();
    CommandRegistry = class {
      commands = /* @__PURE__ */ new Map();
      aliasMap = /* @__PURE__ */ new Map();
      constructor() {
        this.registerDefaults();
      }
      register(spec, handler) {
        const registered = { ...spec, handler };
        this.commands.set(spec.id, registered);
        if (spec.aliases) {
          for (const alias of spec.aliases) {
            this.aliasMap.set(alias, spec.id);
          }
        }
      }
      get(idOrAlias) {
        const canonical2 = this.aliasMap.get(idOrAlias) ?? idOrAlias;
        return this.commands.get(canonical2) ?? null;
      }
      all() {
        return Array.from(this.commands.values());
      }
      async execute(rawInput, ctx) {
        const trimmed = rawInput.trim();
        if (!trimmed.startsWith("/")) return false;
        const body = trimmed.slice(1).trim();
        const [name, ...args] = body.split(/\s+/);
        if (!name) return false;
        const command = this.get(name.toLowerCase());
        if (!command) {
          ctx.addError(`Unknown command "/${name}". Type /help for available commands.`);
          return true;
        }
        const requiredArguments = command.arguments?.filter((argument) => argument.required).length ?? 0;
        if (args.length < requiredArguments) {
          ctx.addError(`Usage: ${command.usage ?? `/${command.id}`}`);
          return true;
        }
        for (const [index, argument] of (command.arguments ?? []).entries()) {
          const value = args[index]?.toLowerCase();
          if (value && argument.values && !argument.values.includes(value)) {
            ctx.addError(
              `Invalid ${argument.name} "${args[index]}". Choose ${argument.values.join(" or ")}.`
            );
            return true;
          }
        }
        try {
          await command.handler(args, ctx);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.addError(`Command /${name} failed: ${message}`);
        }
        return true;
      }
      getSuggestions(context, input) {
        if (!input.startsWith("/")) return [];
        const trimmed = input.slice(1);
        const hasSpace = trimmed.includes(" ");
        const parts = trimmed.split(/\s+/);
        const commandName = parts[0]?.toLowerCase() ?? "";
        const argument = parts.slice(1).join(" ").trim();
        if (!hasSpace) {
          const needle = commandName;
          const suggestions = [];
          for (const cmd2 of this.all()) {
            if (!cmd2.surfaces.includes("slash")) continue;
            const matchesName = cmd2.id.startsWith(needle);
            const matchedAlias = cmd2.aliases?.find((a) => a.startsWith(needle));
            if (!needle || matchesName || matchedAlias) {
              const display = `/${cmd2.id}`;
              const argHint = cmd2.arguments?.length ? ` ${cmd2.arguments.map((a) => a.required ? `<${a.name}>` : `[${a.name}]`).join(" ")}` : "";
              suggestions.push({
                value: `/${cmd2.id}`,
                label: display,
                detail: cmd2.summary,
                hint: argHint,
                submit: !(cmd2.arguments ?? []).some((a) => a.required)
              });
            }
          }
          return suggestions.sort((a, b) => a.label.localeCompare(b.label)).slice(0, 10);
        }
        const cmd = this.get(commandName);
        if (!cmd) return [];
        if (cmd.id === "model") {
          if (!argument) return [];
          const needle = argument.toLowerCase();
          const profiles = context.store.listProfiles();
          return context.store.listModels().filter((model) => profiles.some((p) => p.providerId === model.providerId)).filter(
            (model) => !needle || model.modelId.toLowerCase().includes(needle) || model.displayName.toLowerCase().includes(needle)
          ).sort((a, b) => b.codingSuitability - a.codingSuitability).slice(0, 8).map((model) => ({
            value: `/model ${model.modelId}`,
            label: model.modelId,
            detail: `${model.providerId} ${glyph.bullet} ${model.displayName || model.modelId}`,
            submit: true
          }));
        }
        if (cmd.id === "profile") {
          const needle = argument.toLowerCase();
          return context.store.listProfiles().filter(
            (profile) => !needle || profile.name.toLowerCase().includes(needle) || profile.id.toLowerCase().startsWith(needle)
          ).slice(0, 8).map((profile) => ({
            value: `/profile ${profile.name}`,
            label: profile.name,
            detail: `${profile.providerId} ${glyph.bullet} ${profile.defaultModel ?? "no model"}`,
            submit: true
          }));
        }
        if (cmd.id === "resume") {
          const needle = argument.toLowerCase();
          return context.store.listTasks({ projectPath: context.cwd, limit: 20 }).filter((task) => !needle || task.id.toLowerCase().startsWith(needle)).slice(0, 6).map((task) => ({
            value: `/resume ${task.id.slice(0, 8)}`,
            label: task.id.slice(0, 8),
            detail: `${task.status} \xB7 ${task.userRequest.slice(0, 40)}`,
            submit: true
          }));
        }
        if (cmd.id === "mode") {
          return AGENT_MODE_IDS.filter((mode) => !argument || mode.startsWith(argument.toLowerCase())).map((mode) => ({
            value: `/mode ${mode}`,
            label: mode,
            detail: mode === "build" ? "Full coding agent" : mode === "plan" ? "Read-only planning" : "Diagnosis-first debugging",
            submit: true
          }));
        }
        if (cmd.id === "allow-paid") {
          return ["on", "off"].filter((opt) => !argument || opt.startsWith(argument.toLowerCase())).map((opt) => ({
            value: `/allow-paid ${opt}`,
            label: opt,
            detail: opt === "on" ? "Allow paid model fallbacks" : "Only use free-tier models",
            submit: true
          }));
        }
        return [];
      }
      registerDefaults() {
        const specs = slashCommandSpecs();
        const findSpec = (id) => specs.find((s) => s.id === id) ?? COMMAND_SPECS.find((s) => s.id === id) ?? {
          id,
          summary: id,
          description: id,
          category: "system",
          surfaces: ["slash"]
        };
        this.register(findSpec("help"), (_args, ctx) => {
          const text = ["Commands", ...commandReferenceLines()].join("\n");
          if (ctx.showOutput) ctx.showOutput("help", text);
          else ctx.addNotice("help", text);
        });
        this.register(findSpec("model"), (args, ctx) => {
          const target = args.join(" ").trim();
          if (!target) {
            ctx.openDialog("model-picker");
            return;
          }
          try {
            const resolved = resolveModel(ctx.context.store, target);
            ctx.context.store.setSelectedProfileId(resolved.profile.id);
            ctx.context.store.setSelectedModelId(resolved.model.id);
            ctx.notify(`Using ${resolved.model.modelId} via ${resolved.profile.name}.`);
            ctx.refreshData();
          } catch (error) {
            ctx.addError(error instanceof Error ? error.message : String(error));
          }
        });
        this.register(findSpec("models"), (_args, ctx) => {
          ctx.openDialog("model-picker");
        });
        this.register(findSpec("connect"), (_args, ctx) => {
          ctx.openDialog("connect");
        });
        this.register(findSpec("providers"), (_args, ctx) => {
          ctx.openDialog("providers");
        });
        this.register(findSpec("status"), (_args, ctx) => {
          ctx.openDialog("status");
        });
        this.register(findSpec("usage"), (_args, ctx) => {
          ctx.openDialog("usage");
        });
        this.register(findSpec("tasks"), (_args, ctx) => {
          ctx.openDialog("tasks");
        });
        this.register(findSpec("resume"), async (args, ctx) => {
          const target = args[0]?.trim();
          if (target) {
            const tasks2 = ctx.context.store.listTasks({ projectPath: ctx.context.cwd, limit: 200 });
            const exact = tasks2.find((t) => t.id === target) ?? tasks2.find((t) => t.id.startsWith(target));
            if (!exact) {
              ctx.addError(`Task not found: ${target}`);
              return;
            }
            await ctx.executeTask(exact.id, true);
            return;
          }
          const activeId = ctx.getActiveTaskId();
          if (activeId) {
            await ctx.executeTask(activeId, true);
            return;
          }
          const tasks = ctx.context.store.listTasks({ projectPath: ctx.context.cwd, limit: 50 });
          const paused = tasks.find((t) => t.status === "paused" || t.status === "failed");
          if (paused) {
            await ctx.executeTask(paused.id, true);
          } else {
            ctx.addNotice("notice", "No paused task to resume.");
          }
        });
        this.register(findSpec("clear"), (_args, ctx) => {
          ctx.clearTranscript();
        });
        this.register(findSpec("compact"), (_args, ctx) => {
          const activeId = ctx.getActiveTaskId();
          if (!activeId) {
            ctx.addNotice("notice", "No active task to compact.");
            return;
          }
          try {
            const res = compactTask(ctx.context.store, activeId);
            const text = `Context compacted (${res.record.messagesCompacted} messages summarized).
${res.record.summary.slice(0, 400)}\u2026`;
            if (ctx.showOutput) ctx.showOutput("compact", text);
            else ctx.addNotice("compact", text);
            ctx.notify("Context compacted successfully.");
            ctx.refreshData();
          } catch (error) {
            ctx.addError(error instanceof Error ? error.message : String(error));
          }
        });
        this.register(findSpec("settings"), (_args, ctx) => {
          ctx.openDialog("settings");
        });
        this.register(findSpec("undo"), (_args, ctx) => {
          ctx.openDialog("undo");
        });
        this.register(findSpec("diff"), (_args, ctx) => {
          ctx.openDialog("diff");
        });
        this.register(findSpec("shortcuts"), (_args, ctx) => {
          ctx.openDialog("shortcuts");
        });
        this.register(findSpec("new"), (_args, ctx) => {
          ctx.setTaskId(null);
          ctx.clearTranscript();
          ctx.notify("Ready for a new task.");
        });
        this.register(findSpec("delete"), async (args, ctx) => {
          const store = ctx.context.store;
          const target = args.join(" ").trim();
          let task = null;
          if (target) {
            const tasks = store.listTasks({ projectPath: ctx.context.cwd, limit: 200 });
            task = tasks.find((t) => t.id === target) ?? tasks.find((t) => t.id.startsWith(target)) ?? null;
            if (!task) {
              ctx.addError(`Task not found: ${target}`);
              return;
            }
          } else {
            const activeId = ctx.getActiveTaskId();
            task = activeId ? store.getTask(activeId) : null;
            if (!task) {
              ctx.addError("No active task to delete. Open /tasks and press ctrl+d for saved history.");
              return;
            }
          }
          if (task.status === "running") {
            ctx.addError("Cannot delete a running task. Pause it first.");
            return;
          }
          if (!ctx.confirm) {
            ctx.addError("Confirmation is unavailable in this context.");
            return;
          }
          const title = typeof task.metadata.title === "string" && task.metadata.title.trim() ? task.metadata.title : task.userRequest;
          const decision = await ctx.confirm({
            kind: "task-delete",
            title: "Delete task?",
            description: `Permanently removes "${title.slice(0, 100)}" and its messages/checkpoints.`
          });
          if (decision !== "allow") return;
          store.deleteTask(task.id);
          if (ctx.getActiveTaskId() === task.id) ctx.setTaskId(null);
          ctx.notify(`Deleted task ${task.id.slice(0, 8)}.`);
          ctx.refreshData();
        });
        this.register(findSpec("profile"), (args, ctx) => {
          const name = args.join(" ").trim();
          if (!name) {
            ctx.openDialog("effort");
            return;
          }
          try {
            const profile = resolveProfile(ctx.context.store, name);
            ctx.context.store.setSelectedProfileId(profile.id);
            ctx.notify(`Using profile ${profile.name}.`);
            ctx.refreshData();
          } catch (error) {
            ctx.addError(error instanceof Error ? error.message : String(error));
          }
        });
        this.register(findSpec("storage"), (_args, ctx) => {
          const stats = ctx.context.store.storageStats();
          const lines = [
            `Database: ${stats.path ?? ""}`,
            `Size: ${(stats.dbBytes / 1024).toFixed(1)} KB`,
            "",
            ...Object.entries(stats.tables).map(
              ([table, count]) => `  ${table.padEnd(20)} ${count}`
            )
          ];
          const text = lines.join("\n");
          if (ctx.showOutput) ctx.showOutput("storage", text);
          else ctx.addNotice("storage", text);
        });
        this.register(findSpec("cleanup"), (args, ctx) => {
          const parsed = Number(args[0]);
          const days = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : ctx.context.store.getSettings().storage.retentionDays;
          const { deletedTasks } = ctx.context.store.cleanupCompletedOlderThan(days);
          ctx.notify(
            deletedTasks === 0 ? `Nothing to clean \u2014 no completed/failed tasks older than ${days} days.` : `Removed ${deletedTasks} old task(s) and vacuumed the database.`
          );
          ctx.refreshData();
        });
        this.register(findSpec("copy"), async (args, ctx) => {
          const mode = (args[0] ?? "").toLowerCase();
          if (mode === "all" || mode === "transcript") {
            const transcript = ctx.getTranscriptText?.().trim();
            if (!transcript) {
              ctx.addNotice("copy", "The transcript is empty.");
              return;
            }
            const { copyToClipboard: copyToClipboard3 } = await Promise.resolve().then(() => (init_clipboard(), clipboard_exports));
            const ok2 = await copyToClipboard3(transcript.slice(0, 5e5));
            ctx.notify(
              ok2 ? `Copied the full transcript (${transcript.length} chars) to clipboard.` : "Clipboard unavailable. Use ctrl+y and your terminal copy shortcut."
            );
            return;
          }
          const taskId = ctx.getActiveTaskId();
          const messages = taskId ? ctx.context.store.loadMessages(taskId, 60) : [];
          const last = [...messages].reverse().find((message) => message.role === "assistant" || message.role === "tool");
          const text = last?.content?.trim();
          if (!text) {
            ctx.addNotice("copy", "Nothing to copy yet. Use /copy all for the transcript.");
            return;
          }
          const { copyToClipboard: copyToClipboard2 } = await Promise.resolve().then(() => (init_clipboard(), clipboard_exports));
          const ok = await copyToClipboard2(text.slice(0, 2e5));
          ctx.notify(ok ? `Copied ${text.length} chars to clipboard.` : "Clipboard unavailable.");
        });
        this.register(findSpec("allow-paid"), (args, ctx) => {
          const value = args[0]?.toLowerCase();
          if (value !== "on" && value !== "off") {
            ctx.addNotice("notice", "Usage: /allow-paid on|off");
            return;
          }
          const isAllowed = value === "on";
          ctx.context.store.updateSettings((settings) => {
            settings.routing.allowPaid = isAllowed;
            return settings;
          });
          ctx.notify(`Paid fallbacks ${isAllowed ? "enabled" : "disabled"}.`);
          ctx.refreshData();
        });
        this.register(findSpec("mode"), (args, ctx) => {
          const target = args[0]?.toLowerCase();
          if (!target) {
            ctx.notify(`Agent mode: ${ctx.agentMode ?? "build"} (tab cycles, /mode build|plan|debug)`);
            return;
          }
          if (!isAgentMode(target)) {
            ctx.addError(`Unknown mode "${target}". Choose ${AGENT_MODE_IDS.join(", ")}.`);
            return;
          }
          ctx.setAgentMode?.(target);
          ctx.notify(
            target === "plan" ? "Plan mode: read-only. The agent will propose steps without changing files." : target === "debug" ? "Debug mode: diagnosis-first with full tools." : "Build mode: full coding agent."
          );
          ctx.refreshData();
        });
        this.register(findSpec("skills"), (_args, ctx) => {
          const skills = loadSkills(ctx.context.cwd);
          if (skills.length === 0) {
            ctx.addNotice("skills", "No skills found. Add SKILL.md files under .comicode/skills/.");
            return;
          }
          const lines = skills.map(
            (skill) => `  ${skill.name.padEnd(28)} ${skill.description}  (${skill.source})`
          );
          const text = ["Available skills (agent loads them via use_skill):", ...lines].join("\n");
          if (ctx.showOutput) ctx.showOutput("skills", text);
          else ctx.addNotice("skills", text);
        });
        this.register(findSpec("tools"), (_args, ctx) => {
          ctx.toggleToolsExpanded();
        });
        this.register(findSpec("workspace"), (_args, ctx) => {
          ctx.navigateToScreen("workspace");
        });
        this.register(findSpec("exit"), (_args, ctx) => {
          ctx.onQuit();
        });
      }
    };
    commandRegistry = new CommandRegistry();
  }
});

// src/tui/screens/workspace.tsx
import { useCallback, useEffect as useEffect3, useMemo as useMemo2, useRef as useRef3, useState as useState3 } from "react";
import { Box as Box4, Text as Text4, useInput as useInput3 } from "ink";
import { Fragment, jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
function taskToEntries(context, task) {
  const stored = context.store.loadStoredMessages(task.id, 80);
  let id = 0;
  const entries = [];
  for (const message of stored) {
    if (message.role === "user") {
      entries.push({ id: ++id, kind: "user", text: clipLines(message.content, 3, 500) });
    } else if (message.role === "assistant") {
      if (message.content.trim()) {
        entries.push({
          id: ++id,
          kind: "assistant",
          text: clipLines(message.content, 100, 2e4)
        });
      }
      for (const call of message.toolCalls ?? []) {
        entries.push({
          id: ++id,
          kind: "tool",
          title: call.name,
          text: clip(JSON.stringify(call.arguments ?? {}), 120)
        });
      }
    } else if (message.role === "tool") {
      entries.push({
        id: ++id,
        kind: "tool",
        title: `${message.name ?? "tool"} result`,
        text: clipLines(message.content, 2, 300)
      });
    }
  }
  entries.push({
    id: ++id,
    kind: "notice",
    text: `Loaded task ${task.id.slice(0, 8)} (${task.status}, phase ${task.phase}). ${task.userRequest}`
  });
  return entries;
}
function roleFor(entry) {
  switch (entry.kind) {
    case "user":
      return {
        label: "you",
        color: theme.warm,
        marker: "\u258C",
        bodyColor: theme.text,
        lines: 5,
        chars: 1200
      };
    case "assistant":
      return {
        label: "comicode",
        color: theme.accent,
        marker: "\u25C6",
        bodyColor: theme.text,
        lines: 8,
        chars: 4e3
      };
    case "tool":
      return {
        label: entry.title ?? "tool",
        color: theme.muted,
        marker: glyph.tool,
        bodyColor: theme.faint,
        lines: 3,
        chars: 600
      };
    case "route":
      return {
        label: "route",
        color: theme.violet,
        marker: glyph.route,
        bodyColor: theme.faint,
        lines: 2,
        chars: 400
      };
    case "error":
      return {
        label: entry.title ?? "error",
        color: theme.danger,
        marker: glyph.cross,
        bodyColor: theme.danger,
        lines: 5,
        chars: 1200
      };
    case "paused":
      return {
        label: entry.title ?? "paused",
        color: theme.warning,
        marker: glyph.pause,
        bodyColor: theme.warning,
        lines: 5,
        chars: 1200
      };
    case "summary":
      return {
        label: entry.title ?? "completed",
        color: theme.success,
        marker: glyph.check,
        bodyColor: theme.text,
        lines: 7,
        chars: 2400
      };
    case "review":
      return {
        label: entry.title ?? "reviewer",
        color: theme.info,
        marker: "\u25C7",
        bodyColor: theme.text,
        lines: 6,
        chars: 2e3
      };
    case "plan":
      return {
        label: entry.title ?? "plan",
        color: theme.accent,
        marker: "\u25A4",
        bodyColor: theme.text,
        lines: 6,
        chars: 2e3
      };
    default:
      return {
        label: entry.title ?? "notice",
        color: theme.faint,
        marker: glyph.bullet,
        bodyColor: theme.muted,
        lines: entry.title === "help" ? 18 : 5,
        chars: entry.title === "help" ? 5e3 : 1200
      };
  }
}
function clipAnswer(text, headLines = 14, tailLines = 30) {
  const maxChars = 2e4;
  let body = text;
  if (body.length > maxChars) {
    const headChars = Math.floor(maxChars * 0.4);
    body = `${body.slice(0, headChars)}
\u2026
${body.slice(-(maxChars - headChars))}`;
  }
  const lines = body.split("\n");
  if (lines.length <= headLines + tailLines + 2) return body;
  const hidden = lines.length - headLines - tailLines;
  return [...lines.slice(0, headLines), `[+${hidden} lines]`, ...lines.slice(-tailLines)].join(
    "\n"
  );
}
function entryDisplay(entry) {
  if (entry.kind === "assistant") return clipAnswer(entry.text);
  if (entry.kind === "summary") return clipAnswer(entry.text, 20, 40);
  if (entry.kind === "review") return clipAnswer(entry.text, 12, 24);
  const role = roleFor(entry);
  return clipLines(entry.text, role.lines, role.chars);
}
function transcriptText(entries) {
  return entries.map((entry) => {
    const role = roleFor(entry);
    return `${role.marker} ${role.label}
${entryDisplay(entry)}`;
  }).join("\n\n");
}
function wrapBodyLines(text, width) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length === 0) {
      lines.push("");
      continue;
    }
    for (const wrapped of wrapText(raw, width)) lines.push(wrapped.text);
  }
  return lines.length > 0 ? lines : [""];
}
function EntryCard({
  entry,
  dimmed,
  bodyLines,
  fromLine = 0,
  toLine,
  showHeader = true,
  showMargin = true
}) {
  const role = roleFor(entry);
  const lines = bodyLines ?? wrapBodyLines(entryDisplay(entry), 80);
  const end = Math.max(0, Math.min(lines.length, toLine ?? lines.length));
  const start = Math.max(0, Math.min(end, fromLine));
  const visible = lines.slice(start, end);
  return /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", marginBottom: showMargin ? 1 : 0, flexShrink: 0, children: [
    showHeader ? /* @__PURE__ */ jsxs4(Text4, { color: role.color, bold: true, dimColor: dimmed, children: [
      role.marker,
      " ",
      role.label
    ] }) : null,
    visible.length > 0 ? /* @__PURE__ */ jsx4(Box4, { paddingLeft: 2, flexDirection: "column", children: visible.map((line, index) => /* @__PURE__ */ jsx4(Text4, { color: role.bodyColor, wrap: "truncate", dimColor: dimmed, children: line.length > 0 ? line : " " }, `${start + index}`)) }) : null
  ] });
}
function Workspace({
  context,
  active,
  onStatusChange,
  onNavigate,
  onCycleScreen,
  onOpenDialog,
  onQuit,
  resumeRequest,
  notify,
  refreshData,
  dimmed = false,
  agentMode = "build",
  onAgentMode,
  onShowOutput,
  selectionMode = false,
  onToggleSelection
}) {
  const { rows, columns } = useLayout();
  const [entries, setEntries] = useState3([]);
  const [input, setInput] = useState3("");
  const [queue, setQueue] = useState3([]);
  const [history2, setHistory] = useState3([]);
  const [scrollOffset, setScrollOffset] = useState3(0);
  const [jumpOpen, setJumpOpen] = useState3(false);
  const [jumpIndex, setJumpIndex] = useState3(0);
  const [running, setRunning] = useState3(false);
  const [status, setStatus] = useState3("idle");
  const [taskId, setTaskId] = useState3(null);
  const [plan, setPlan] = useState3(null);
  const [route, setRoute] = useState3(null);
  const [usage2, setUsage] = useState3({ inputTokens: 0, outputTokens: 0 });
  const [lastInputTokens, setLastInputTokens] = useState3(0);
  const [confirmRequest, setConfirmRequest] = useState3(null);
  const [frame, setFrame] = useState3(0);
  const [pauseReason, setPauseReason] = useState3(null);
  const [lastResult, setLastResult] = useState3(null);
  const nextId = useRef3(1);
  const abortRef = useRef3(null);
  const confirmResolve = useRef3(null);
  const adoptedNonce = useRef3(0);
  const streamingId = useRef3(null);
  const maxOffsetRef = useRef3(0);
  const updateStatus = useCallback(
    (next) => {
      setStatus(next);
      onStatusChange(next);
    },
    [onStatusChange]
  );
  const addEntry = useCallback((entry) => {
    const id = nextId.current++;
    setEntries((previous) => [...previous.slice(-240), { ...entry, id }]);
    return id;
  }, []);
  const removeEntry = useCallback((id) => {
    setEntries((previous) => previous.filter((entry) => entry.id !== id));
  }, []);
  useEffect3(() => {
    if (!running || selectionMode) return;
    const timer = setInterval(() => setFrame((value) => value + 1), 120);
    return () => clearInterval(timer);
  }, [running, selectionMode]);
  const mouseScrollEnabled = context.store.getSettings().ui.mouseScroll === true;
  useEffect3(() => {
    if (selectionMode) {
      disableMouseTracking();
      return;
    }
    if (!active) return;
    disableMouseTracking();
    if (!mouseScrollEnabled) return;
    return enableMouseWheel((direction) => {
      if (!active) return;
      setScrollOffset(
        (value) => Math.max(0, Math.min(maxOffsetRef.current, value - direction * 3))
      );
    });
  }, [active, context, selectionMode, mouseScrollEnabled]);
  const respondConfirm = useCallback((decision) => {
    const resolve6 = confirmResolve.current;
    confirmResolve.current = null;
    setConfirmRequest(null);
    resolve6?.(decision);
  }, []);
  const askConfirm = useCallback(
    (request) => new Promise((resolve6) => {
      confirmResolve.current = resolve6;
      setConfirmRequest(request);
    }),
    []
  );
  const makeHooks = useCallback(() => {
    return {
      confirm: askConfirm,
      onText: (delta) => {
        let id = streamingId.current;
        if (id === null) {
          id = nextId.current++;
          streamingId.current = id;
          setEntries((previous) => [
            ...previous.slice(-240),
            { id, kind: "assistant", text: "" }
          ]);
        }
        setEntries(
          (previous) => previous.map(
            (entry) => entry.id === id ? { ...entry, text: (entry.text + delta).slice(-8e4) } : entry
          )
        );
      },
      onAssistantMessage: (content) => {
        const id = streamingId.current;
        streamingId.current = null;
        if (!content.trim()) {
          if (id !== null) removeEntry(id);
          return;
        }
        if (id === null) {
          addEntry({ kind: "assistant", text: content.slice(-8e4) });
        }
      },
      onToolStart: (call) => {
        addEntry({
          kind: "tool",
          title: call.name,
          text: clip(JSON.stringify(call.arguments ?? {}), 180)
        });
      },
      onToolResult: (call, result) => {
        const firstLine = result.content.split(/\r?\n/).find((line) => line.trim()) ?? "";
        addEntry({
          kind: result.ok ? "tool" : "error",
          title: `${result.ok ? glyph.check : glyph.cross} ${call.name}`,
          text: clip(firstLine, 180)
        });
      },
      onRoute: (decision) => {
        setRoute(`${decision.candidate.profile.name}/${decision.candidate.model.modelId}`);
        addEntry({
          kind: "route",
          text: `${decision.candidate.profile.name}/${decision.candidate.model.modelId} \u2014 ${decision.reason}`
        });
      },
      onUsage: (turnUsage) => {
        setUsage((previous) => ({
          inputTokens: previous.inputTokens + turnUsage.inputTokens,
          outputTokens: previous.outputTokens + turnUsage.outputTokens
        }));
        setLastInputTokens(turnUsage.inputTokens);
      },
      onPlan: (value) => {
        const planValue = value;
        if (planValue?.steps) setPlan(planValue);
      },
      onReview: (review) => {
        addEntry({ kind: "review", title: "reviewer", text: clipLines(review, 10, 3e3) });
      },
      onNotice: (message) => {
        addEntry({ kind: "notice", text: message });
      },
      onRetry: (info) => {
        addEntry({
          kind: "notice",
          text: `retrying ${info.category} in ${(info.delayMs / 1e3).toFixed(1)}s (attempt ${info.attempt})`
        });
      },
      onPaused: (reason) => {
        setPauseReason(reason);
        addEntry({ kind: "paused", title: "paused", text: reason });
      },
      onTaskComplete: (summary) => {
        if (!summary) return;
        const norm = (value) => value.toLowerCase().replace(/\s+/g, " ").trim();
        const summaryNorm = norm(summary);
        setEntries((previous) => {
          const lastAssistant = [...previous].reverse().find((entry) => entry.kind === "assistant");
          const assistantNorm = lastAssistant ? norm(lastAssistant.text) : "";
          const duplicate = assistantNorm.length > 0 && summaryNorm.length > 0 && (summaryNorm.includes(assistantNorm) || assistantNorm.includes(summaryNorm) || summaryNorm.slice(0, 160) === assistantNorm.slice(0, 160));
          if (duplicate) return previous;
          return [
            ...previous,
            {
              id: nextId.current++,
              kind: "summary",
              title: "completed",
              text: clipLines(summary, 10, 3e3)
            }
          ];
        });
      }
    };
  }, [addEntry, removeEntry]);
  const execute = useCallback(
    async (id, resume) => {
      if (running) return;
      updateStatus("running");
      setRunning(true);
      setPauseReason(null);
      setLastResult(null);
      setPlan(null);
      setRoute(null);
      setScrollOffset(0);
      streamingId.current = null;
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const agent = new CodingAgent({
          store: context.store,
          taskId: id,
          hooks: makeHooks(),
          authority: { ...DEFAULT_AUTHORITY },
          settings: context.store.getSettings(),
          mode: agentMode
        });
        const result = await agent.run({
          resume,
          signal: controller.signal,
          maxSteps: context.store.getSettings().agent.maxSteps
        });
        if (result.status === "completed") {
          updateStatus("completed");
          setLastResult(result.summary ?? "Task completed.");
        } else if (result.status === "paused") {
          updateStatus("paused");
          setPauseReason(result.pauseReason ?? "Paused.");
        } else {
          updateStatus("failed");
          setLastResult(result.summary ?? "Task did not complete.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addEntry({ kind: "error", title: "error", text: message });
        updateStatus("failed");
        setLastResult(message);
      } finally {
        abortRef.current = null;
        setRunning(false);
        streamingId.current = null;
        refreshData();
      }
    },
    [addEntry, agentMode, askConfirm, context, makeHooks, refreshData, running, updateStatus]
  );
  const startRequest = useCallback(
    async (request) => {
      if (!request.trim() || running) return;
      try {
        const profiles = context.store.listProfiles();
        const selectedId = context.store.getSelectedProfileId();
        const profile = profiles.find((entry) => entry.id === selectedId) ?? profiles.find((entry) => entry.enabled) ?? null;
        if (!profile) {
          addEntry({
            kind: "error",
            title: "no provider",
            text: "No provider profile is connected. Open providers and add one first."
          });
          return;
        }
        const modelKey = context.store.getSelectedModelId();
        const model = modelKey ? context.store.listModels().find((entry) => entry.id === modelKey) ?? null : null;
        addEntry({ kind: "user", text: request });
        const mentions = [
          ...new Set(
            [...request.matchAll(/@([^\s@]+)/g)].map((match) => match[1]).filter((path) => fileIndex.length === 0 || fileIndex.includes(path))
          )
        ];
        const withMentions = (task3) => {
          if (!mentions.length) return;
          context.store.updateTask(task3.id, {
            relevantFiles: [.../* @__PURE__ */ new Set([...task3.relevantFiles ?? [], ...mentions])]
          });
        };
        if (!taskId) {
          const task3 = context.store.createTask({
            projectPath: context.cwd,
            projectName: context.cwd.split(/[\\/]/).filter(Boolean).pop() ?? "project",
            userRequest: request,
            taskType: "coding",
            currentProfileId: profile.id,
            currentModelId: model?.modelId ?? profile.defaultModel ?? null,
            metadata: { createdBy: "tui", source: "comicode" }
          });
          withMentions(task3);
          setTaskId(task3.id);
          await execute(task3.id, false);
          return;
        }
        const task2 = context.store.getTask(taskId);
        if (!task2) {
          setTaskId(null);
          addEntry({
            kind: "error",
            text: "The active task no longer exists. Starting a new task."
          });
          return;
        }
        context.store.appendMessage(task2.id, { role: "user", content: request });
        withMentions(task2);
        context.store.updateTask(task2.id, {
          status: "running",
          phase: task2.phase === "done" ? "implement" : task2.phase,
          completedAt: null
        });
        await execute(task2.id, task2.status === "paused" || task2.status === "failed");
      } catch (error) {
        addEntry({
          kind: "error",
          text: error instanceof Error ? error.message : String(error)
        });
      }
    },
    [addEntry, context, execute, running, taskId]
  );
  const adopt = useCallback(
    async (request) => {
      const task2 = context.store.getTask(request.taskId);
      if (!task2) {
        notify("Task not found.");
        return;
      }
      setTaskId(task2.id);
      setPlan(task2.plan);
      setPauseReason(task2.error ?? null);
      setEntries(taskToEntries(context, task2));
      setUsage({ inputTokens: 0, outputTokens: 0 });
      setLastInputTokens(0);
      setLastResult(task2.summary);
      setScrollOffset(0);
      if (request.resume) await execute(task2.id, true);
      else updateStatus(task2.status === "completed" ? "completed" : "idle");
    },
    [context, execute, notify, updateStatus]
  );
  useEffect3(() => {
    if (!resumeRequest || resumeRequest.nonce === adoptedNonce.current) return;
    adoptedNonce.current = resumeRequest.nonce;
    void adopt(resumeRequest);
  }, [adopt, resumeRequest]);
  const [fileIndex, setFileIndex] = useState3([]);
  useEffect3(() => {
    let active2 = true;
    void listProjectFiles(context.cwd, 4e3).then((files) => {
      if (active2) setFileIndex(files.map((file) => file.path));
    }).catch(() => {
    });
    return () => {
      active2 = false;
    };
  }, [context.cwd]);
  const suggestions = useMemo2(() => {
    const mention = /(^|\s)@([^\s@]*)$/.exec(input);
    if (mention) {
      const atIndex = input.length - mention[0].length + (mention[1]?.length ?? 0);
      const prefix = input.slice(0, atIndex);
      const needle = mention[2].toLowerCase();
      return fileIndex.filter((path) => {
        const lower = path.toLowerCase();
        return lower.includes(needle) || (path.split("/").pop() ?? "").toLowerCase().includes(needle);
      }).slice(0, 8).map((path) => ({
        value: `${prefix}@${path} `,
        label: path.split("/").pop() ?? path,
        detail: path,
        submit: false
      }));
    }
    if (!input.startsWith("/")) return [];
    return commandRegistry.getSuggestions(context, input);
  }, [context, input, fileIndex]);
  const handleCommand = useCallback(
    async (raw) => {
      const commandContext = {
        context,
        notify,
        refreshData,
        openDialog: (d) => onOpenDialog?.(d),
        closeDialog: () => onOpenDialog?.(null),
        navigateToScreen: (s) => onNavigate(s),
        setTaskId: (id) => {
          setTaskId(id);
          if (!id) {
            setPlan(null);
            setPauseReason(null);
            setLastResult(null);
            setUsage({ inputTokens: 0, outputTokens: 0 });
            setLastInputTokens(0);
            setEntries([]);
            setScrollOffset(0);
            updateStatus("idle");
          }
        },
        getActiveTaskId: () => taskId,
        getTranscriptText: () => transcriptText(entries),
        clearTranscript: () => {
          setEntries([]);
          setScrollOffset(0);
        },
        addNotice: (title, text) => {
          if (onShowOutput && ["help", "skills", "compact"].includes(title)) {
            onShowOutput(title, text);
          } else {
            addEntry({ kind: "notice", title, text });
          }
        },
        showOutput: onShowOutput,
        addError: (text) => {
          addEntry({ kind: "error", text });
        },
        executeTask: async (id, resume) => {
          await execute(id, resume);
        },
        toggleToolsExpanded: () => {
        },
        onQuit,
        agentMode,
        setAgentMode: (mode) => onAgentMode?.(mode),
        confirm: askConfirm
      };
      const handled = await commandRegistry.execute(raw, commandContext);
      if (!handled) {
        addEntry({
          kind: "error",
          text: `Unknown command "${raw.trim()}". Type /help for available commands.`
        });
      }
    },
    [
      addEntry,
      agentMode,
      askConfirm,
      context,
      execute,
      notify,
      onAgentMode,
      onNavigate,
      onOpenDialog,
      onQuit,
      onShowOutput,
      refreshData,
      taskId,
      updateStatus
    ]
  );
  const submit = useCallback(
    (value) => {
      const trimmed = value.trim();
      setInput("");
      if (!trimmed) return;
      setHistory(
        (previous) => [...previous.filter((item) => item !== trimmed), trimmed].slice(-60)
      );
      setScrollOffset(0);
      if (running && !trimmed.startsWith("/")) {
        setQueue((previous) => [...previous, trimmed]);
        addEntry({
          kind: "notice",
          title: "queued",
          text: `Queued while the agent runs: ${clip(trimmed, 90)}`
        });
        return;
      }
      if (trimmed.startsWith("/")) {
        void handleCommand(trimmed);
        return;
      }
      void startRequest(trimmed);
    },
    [addEntry, handleCommand, running, startRequest]
  );
  useEffect3(() => {
    if (running || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    if (next.startsWith("/")) void handleCommand(next);
    else void startRequest(next);
  }, [running, queue, handleCommand, startRequest]);
  const bodyWidth = Math.max(24, columns - 8);
  const entryLayouts = useMemo2(() => {
    let line = 0;
    return entries.map((entry) => {
      const lines = wrapBodyLines(entryDisplay(entry), bodyWidth);
      const height = 1 + lines.length + 1;
      const layout = { entry, lines, start: line, height };
      line += height;
      return layout;
    });
  }, [entries, bodyWidth]);
  const totalLines = entryLayouts.reduce((sum, layout) => sum + layout.height, 0);
  const lineBudget = Math.max(5, rows - 18);
  const maxOffset = Math.max(0, totalLines - lineBudget);
  maxOffsetRef.current = maxOffset;
  const visibleOffset = Math.min(scrollOffset, maxOffset);
  const viewStart = Math.max(0, totalLines - lineBudget - visibleOffset);
  const viewEnd = viewStart + lineBudget;
  const visibleLayouts = entryLayouts.filter((layout) => layout.start < viewEnd && layout.start + layout.height > viewStart).map((layout) => {
    const localStart = Math.max(0, viewStart - layout.start);
    const localEnd = Math.min(layout.height, viewEnd - layout.start);
    return {
      ...layout,
      localStart,
      localEnd,
      fromLine: Math.max(0, localStart - 1),
      toLine: Math.max(0, localEnd - 1)
    };
  });
  useEffect3(() => {
    setScrollOffset((value) => Math.min(value, maxOffset));
  }, [maxOffset]);
  useInput3(
    (input2, key) => {
      if (isMouseSequence(input2) || isSuppressedInput()) return;
      if (selectionMode) {
        if (key.escape) {
          onToggleSelection?.();
          return;
        }
        if (key.pageUp) {
          setScrollOffset((value) => Math.min(maxOffsetRef.current, value + lineBudget - 2));
          return;
        }
        if (key.pageDown) {
          setScrollOffset((value) => Math.max(0, value - (lineBudget - 2)));
          return;
        }
      }
      if (key.escape && running) {
        abortRef.current?.abort();
        notify("Pausing after the current operation\u2026");
        return;
      }
      if (key.pageUp || key.ctrl && key.upArrow) {
        setScrollOffset((value) => Math.min(maxOffsetRef.current, value + lineBudget - 2));
        return;
      }
      if (key.pageDown || key.ctrl && key.downArrow) {
        setScrollOffset((value) => Math.max(0, value - (lineBudget - 2)));
        return;
      }
      if (key.ctrl && input2 === "j") {
        const users = entries.flatMap((entry, index) => entry.kind === "user" ? [index] : []);
        if (users.length > 0) {
          setJumpIndex(users.length - 1);
          setJumpOpen(true);
        }
        return;
      }
      if (running) {
        if (key.leftArrow) onCycleScreen(-1);
        else if (key.rightArrow) onCycleScreen(1);
        else if (key.tab) onCycleScreen(key.shift ? -1 : 1);
      }
    },
    // Selection mode keeps esc/scroll keys live even while an inline approval
    // prompt is open, but a modal dialog still owns the keyboard.
    { isActive: selectionMode ? !dimmed : active && !dimmed && !confirmRequest }
  );
  const task = taskId ? context.store.getTask(taskId) : null;
  const selectedProfile = (() => {
    const profiles = context.store.listProfiles();
    const selectedId = context.store.getSelectedProfileId();
    return profiles.find((profile) => profile.id === selectedId) ?? profiles.find((profile) => profile.enabled) ?? null;
  })();
  const effortLabel = selectedProfile?.config?.effort;
  const effortText = typeof effortLabel === "string" && effortLabel.length > 0 ? effortLabel : "default";
  const jumpTargets = entries.flatMap((entry, index) => entry.kind === "user" ? [index] : []);
  const jumpTo = useCallback(
    (entryIndex) => {
      const layout = entryLayouts.find((candidate) => candidate.entry === entries[entryIndex]);
      const targetStart = layout?.start ?? 0;
      setScrollOffset(Math.max(0, totalLines - lineBudget - targetStart));
      setJumpOpen(false);
    },
    [entries, entryLayouts, totalLines, lineBudget]
  );
  useInput3(
    (input2, key) => {
      if (key.escape) {
        setJumpOpen(false);
        return;
      }
      const jumpCount = jumpTargets.length;
      if (key.upArrow) {
        setJumpIndex((value) => jumpCount === 0 ? 0 : (value - 1 + jumpCount) % jumpCount);
        return;
      }
      if (key.downArrow || key.pageDown) {
        setJumpIndex((value) => jumpCount === 0 ? 0 : (value + 1) % jumpCount);
        return;
      }
      if (key.return) {
        const target = jumpTargets[Math.min(jumpIndex, jumpTargets.length - 1)];
        if (target !== void 0) jumpTo(target);
      }
    },
    { isActive: jumpOpen }
  );
  const trackHeight = Math.max(6, lineBudget);
  const thumbHeight = totalLines > lineBudget ? Math.max(
    1,
    Math.min(trackHeight, Math.round(trackHeight * lineBudget / Math.max(1, totalLines)))
  ) : 0;
  const thumbTop = thumbHeight > 0 ? Math.round((trackHeight - thumbHeight) * viewStart / Math.max(1, totalLines - lineBudget)) : 0;
  const scrollbar = thumbHeight > 0 ? /* @__PURE__ */ jsx4(Box4, { flexDirection: "column", flexShrink: 0, paddingLeft: 1, children: Array.from({ length: trackHeight }, (_, i) => {
    const inThumb = i >= thumbTop && i < thumbTop + thumbHeight;
    return /* @__PURE__ */ jsx4(
      Text4,
      {
        color: inThumb ? theme.accent : theme.faint,
        dimColor: dimmed && !inThumb,
        children: inThumb ? "\u2588" : "\u2591"
      },
      i
    );
  }) }) : null;
  const jumpShown = jumpTargets.slice(-14);
  const jumpBase = jumpTargets.length - jumpShown.length;
  const jumpSel = Math.min(jumpIndex, Math.max(0, jumpTargets.length - 1));
  const statusColor2 = status === "running" ? theme.accent : status === "completed" ? theme.success : status === "paused" ? theme.warning : status === "failed" ? theme.danger : theme.faint;
  const composerArea = confirmRequest ? /* @__PURE__ */ jsx4(ConfirmDialog, { request: confirmRequest, onDecision: respondConfirm }) : /* @__PURE__ */ jsxs4(Fragment, { children: [
    running ? /* @__PURE__ */ jsx4(Box4, { flexDirection: "column", flexShrink: 0, borderStyle: "round", borderColor: theme.border, children: /* @__PURE__ */ jsxs4(Box4, { paddingX: 1, justifyContent: "space-between", children: [
      /* @__PURE__ */ jsx4(Spinner, { frame, label: route ? `working ${glyph.route} ${route}` : "working" }),
      /* @__PURE__ */ jsxs4(Text4, { color: theme.faint, dimColor: dimmed, children: [
        formatCount(usage2.inputTokens),
        " in / ",
        formatCount(usage2.outputTokens),
        " out",
        lastInputTokens > 0 ? ` \xB7 ctx ~${formatCount(lastInputTokens)}` : "",
        queue.length > 0 ? ` \xB7 ${queue.length} queued` : "",
        `  ${glyph.bullet}  `,
        "type to queue \xB7 esc pauses"
      ] })
    ] }) }) : null,
    /* @__PURE__ */ jsxs4(
      Box4,
      {
        flexDirection: "column",
        flexShrink: 0,
        borderStyle: "round",
        borderColor: status === "paused" ? theme.warning : theme.accentDim,
        paddingX: 1,
        children: [
          /* @__PURE__ */ jsx4(
            PromptInput,
            {
              value: input,
              onChange: setInput,
              onSubmit: submit,
              focus: active && !dimmed,
              suggestions,
              history: history2,
              onCycleScreen,
              onCycleMode: (direction) => onAgentMode?.(nextAgentMode(agentMode, direction)),
              placeholder: status === "paused" ? "Describe the next step, /resume, or /new" : "Ask ComiCode to build, fix, test, or explain\u2026"
            }
          ),
          suggestions.length === 0 ? /* @__PURE__ */ jsx4(Box4, { children: /* @__PURE__ */ jsxs4(Text4, { color: theme.faint, wrap: "truncate", dimColor: dimmed, children: [
            "enter send ",
            glyph.bullet,
            " / commands ",
            glyph.bullet,
            " ctrl+m model ",
            glyph.bullet,
            " ctrl+b provider ",
            glyph.bullet,
            " ctrl+p palette ",
            glyph.bullet,
            " ctrl+j questions"
          ] }) }) : null
        ]
      }
    )
  ] });
  const statusFooter = /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", flexShrink: 0, paddingX: 1, marginTop: 1, children: [
    /* @__PURE__ */ jsxs4(Text4, { wrap: "truncate", dimColor: dimmed, children: [
      /* @__PURE__ */ jsx4(Text4, { color: statusColor2, children: status === "running" ? `${glyph.dot} ${status}` : status === "completed" ? `${glyph.check} ${status}` : status === "failed" ? `${glyph.cross} ${status}` : `${glyph.ring} ${status}` }),
      /* @__PURE__ */ jsxs4(
        Text4,
        {
          color: agentMode === "plan" ? theme.info : agentMode === "debug" ? theme.warning : theme.muted,
          children: [
            "  ",
            glyph.route,
            " ",
            agentMode
          ]
        }
      ),
      /* @__PURE__ */ jsxs4(Text4, { color: theme.faint, children: [
        "  ",
        "effort ",
        effortText
      ] }),
      selectedProfile ? /* @__PURE__ */ jsxs4(Text4, { color: theme.muted, children: [
        "  ",
        glyph.route,
        " ",
        clip(selectedProfile.name, 24)
      ] }) : /* @__PURE__ */ jsxs4(Text4, { color: theme.faint, children: [
        "  ",
        glyph.route,
        " no profile"
      ] })
    ] }),
    /* @__PURE__ */ jsxs4(Text4, { wrap: "truncate", dimColor: dimmed, children: [
      route ? /* @__PURE__ */ jsxs4(Text4, { color: theme.violet, children: [
        glyph.route,
        " ",
        clip(route, 54)
      ] }) : /* @__PURE__ */ jsxs4(Text4, { color: theme.faint, children: [
        glyph.route,
        " no route yet"
      ] }),
      task ? /* @__PURE__ */ jsxs4(Text4, { color: theme.faint, children: [
        "  ",
        glyph.bullet,
        " task ",
        task.id.slice(0, 8)
      ] }) : /* @__PURE__ */ jsxs4(Text4, { color: theme.faint, children: [
        " ",
        glyph.bullet,
        " no task yet"
      ] })
    ] }),
    /* @__PURE__ */ jsxs4(Text4, { color: theme.faint, wrap: "truncate", dimColor: dimmed, children: [
      usage2.inputTokens + usage2.outputTokens > 0 ? `${formatCount(usage2.inputTokens)} in \xB7 ${formatCount(usage2.outputTokens)} out` : `${formatCount(usage2.inputTokens + usage2.outputTokens)} tokens`,
      lastInputTokens > 0 ? ` \xB7 ctx ~${formatCount(lastInputTokens)}` : "",
      pauseReason ? ` ${glyph.bullet} ${clip(pauseReason, 48)}` : lastResult ? ` ${glyph.bullet} ${clip(lastResult, 48)}` : ""
    ] })
  ] });
  const selectionBanner = selectionMode ? /* @__PURE__ */ jsx4(Box4, { flexShrink: 0, paddingTop: 1, children: /* @__PURE__ */ jsxs4(Text4, { color: theme.success, wrap: "truncate", children: [
    "\u2318 SELECT MODE ",
    glyph.bullet,
    " drag to highlight, then copy with your terminal",
    glyph.bullet,
    " esc / ctrl+y exits"
  ] }) }) : null;
  if (entries.length === 0) {
    return /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", flexGrow: 1, paddingX: 2, children: [
      selectionBanner,
      /* @__PURE__ */ jsx4(Box4, { flexDirection: "column", flexGrow: 1, justifyContent: "center", children: /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", alignItems: "center", width: "100%", children: [
        /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", alignItems: "center", marginBottom: 1, children: [
          /* @__PURE__ */ jsx4(Text4, { color: theme.accent, bold: true, wrap: "truncate", children: " \u2588\u2588\u2588\u2588\u2588\u2588\u2557   \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2557   \u2588\u2588\u2588\u2557 \u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2557   \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\n\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D  \u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2551 \u2588\u2588\u2551 \u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D  \u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557 \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557 \u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\n\u2588\u2588\u2551       \u2588\u2588\u2551   \u2588\u2588\u2551 \u2588\u2588\u2554\u2588\u2588\u2588\u2588\u2554\u2588\u2588\u2551 \u2588\u2588\u2551 \u2588\u2588\u2551       \u2588\u2588\u2551   \u2588\u2588\u2551 \u2588\u2588\u2551  \u2588\u2588\u2551 \u2588\u2588\u2588\u2588\u2588\u2557  \n\u2588\u2588\u2551       \u2588\u2588\u2551   \u2588\u2588\u2551 \u2588\u2588\u2551\u255A\u2588\u2588\u2554\u255D\u2588\u2588\u2551 \u2588\u2588\u2551 \u2588\u2588\u2551       \u2588\u2588\u2551   \u2588\u2588\u2551 \u2588\u2588\u2551  \u2588\u2588\u2551 \u2588\u2588\u2554\u2550\u2550\u255D  \n\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D \u2588\u2588\u2551 \u255A\u2550\u255D \u2588\u2588\u2551 \u2588\u2588\u2551 \u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\n \u255A\u2550\u2550\u2550\u2550\u2550\u255D   \u255A\u2550\u2550\u2550\u2550\u2550\u255D  \u255A\u2550\u255D     \u255A\u2550\u255D \u255A\u2550\u255D  \u255A\u2550\u2550\u2550\u2550\u2550\u255D   \u255A\u2550\u2550\u2550\u2550\u2550\u255D  \u255A\u2550\u2550\u2550\u2550\u2550\u255D  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D" }),
          /* @__PURE__ */ jsxs4(Text4, { color: theme.faint, dimColor: dimmed, children: [
            glyph.route,
            " what should we build?"
          ] }),
          /* @__PURE__ */ jsxs4(Text4, { color: theme.faint, dimColor: dimmed, children: [
            "try: \u201Cfix a bug\u201D ",
            glyph.bullet,
            " \u201Cbuild a feature\u201D ",
            glyph.bullet,
            " \u201Cexplain this code\u201D"
          ] })
        ] }),
        /* @__PURE__ */ jsx4(Box4, { flexDirection: "column", width: "100%", maxWidth: 84, children: composerArea }),
        /* @__PURE__ */ jsx4(Box4, { flexDirection: "column", width: "100%", maxWidth: 84, children: statusFooter })
      ] }) })
    ] });
  }
  return /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", flexGrow: 1, overflow: "hidden", children: [
    /* @__PURE__ */ jsxs4(Box4, { flexDirection: "row", flexGrow: 1, overflow: "hidden", children: [
      /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", flexGrow: 1, overflow: "hidden", paddingTop: 1, children: [
        selectionBanner,
        viewStart > 0 ? /* @__PURE__ */ jsx4(Box4, { flexShrink: 0, children: /* @__PURE__ */ jsxs4(Text4, { color: theme.faint, dimColor: dimmed, children: [
          glyph.arrowUp,
          " ",
          viewStart,
          " earlier ",
          viewStart === 1 ? "line" : "lines",
          " ",
          glyph.bullet,
          " pgup to scroll back"
        ] }) }) : null,
        visibleLayouts.map((layout) => /* @__PURE__ */ jsx4(
          EntryCard,
          {
            entry: layout.entry,
            dimmed,
            bodyLines: layout.lines,
            fromLine: layout.fromLine,
            toLine: layout.toLine,
            showHeader: layout.localStart === 0,
            showMargin: layout.localEnd >= layout.height
          },
          layout.entry.id
        )),
        visibleOffset > 0 && visibleLayouts.length === 0 ? /* @__PURE__ */ jsx4(Empty, { children: "No more transcript above. Press pgdn to return to the latest output." }) : null
      ] }),
      scrollbar
    ] }),
    plan?.steps?.length ? /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", flexShrink: 0, marginBottom: 1, children: [
      /* @__PURE__ */ jsxs4(Text4, { color: theme.muted, wrap: "truncate", dimColor: dimmed, children: [
        /* @__PURE__ */ jsx4(Text4, { color: theme.accent, children: "\u25A4 plan " }),
        plan.summary
      ] }),
      /* @__PURE__ */ jsxs4(Text4, { color: theme.faint, dimColor: dimmed, children: [
        plan.steps.filter((step) => step.status === "completed").length,
        "/",
        plan.steps.length,
        " ",
        "steps complete"
      ] })
    ] }) : null,
    composerArea,
    jumpOpen && jumpTargets.length > 0 ? /* @__PURE__ */ jsx4(
      ModalWindow,
      {
        title: "JUMP TO QUESTION",
        subtitle: `${jumpTargets.length} prompt${jumpTargets.length === 1 ? "" : "s"} in this task`,
        width: 72,
        height: Math.min(rows - 4, 20),
        footer: ["\u2191/\u2193 choose", "enter jump to that point", "esc close \xB7 pgdn latest"],
        children: /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", flexGrow: 1, overflow: "hidden", children: [
          jumpShown.map((entryIndex, offset) => {
            const pos = jumpBase + offset;
            const selected = pos === jumpSel;
            const prompt = entries[entryIndex]?.text ?? "";
            return /* @__PURE__ */ jsx4(Box4, { children: /* @__PURE__ */ jsxs4(
              Text4,
              {
                color: selected ? theme.black : theme.text,
                backgroundColor: selected ? theme.accent : void 0,
                wrap: "truncate",
                children: [
                  selected ? `${glyph.active} ` : "  ",
                  clip(prompt, 64)
                ]
              }
            ) }, entryIndex);
          }),
          jumpTargets.length > jumpShown.length ? /* @__PURE__ */ jsxs4(Text4, { color: theme.faint, children: [
            " \u22EE ",
            jumpTargets.length - jumpShown.length,
            " earlier"
          ] }) : null
        ] })
      }
    ) : null,
    statusFooter
  ] });
}
var init_workspace = __esm({
  "src/tui/screens/workspace.tsx"() {
    "use strict";
    init_agent();
    init_modes();
    init_components();
    init_confirm_dialog();
    init_modal();
    init_theme();
    init_registry2();
    init_files();
    init_mouse();
  }
});

// src/tui/screens/providers.tsx
import { useCallback as useCallback2, useEffect as useEffect4, useMemo as useMemo3, useState as useState4 } from "react";
import { Box as Box5, Text as Text5, useInput as useInput4 } from "ink";
import { jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
function kindOptions() {
  const builtins = PROVIDER_ORDER.filter((kind) => kind !== "custom").map((kind) => {
    const definition = getProviderDefinition(kind);
    return {
      key: `builtin:${kind}`,
      label: definition.name,
      detail: definition.description,
      providerId: kind,
      preset: null,
      apiStyle: kind === "gemini" ? "gemini" : "openai-compatible",
      baseUrl: definition.defaultBaseUrl,
      requiresKey: true,
      badge: FREE_BUILTIN_IDS.has(kind) ? "free tier" : void 0,
      config: {}
    };
  });
  const presets2 = PROVIDER_PRESETS.map((preset) => ({
    key: `preset:${preset.id}`,
    label: preset.label,
    detail: preset.notes,
    providerId: "custom",
    preset: preset.id,
    apiStyle: preset.apiStyle,
    baseUrl: preset.baseUrl,
    requiresKey: preset.requiresKey,
    badge: preset.requiresKey ? FREE_PRESET_IDS.has(preset.id) ? "free tier" : void 0 : "local \xB7 free",
    config: {
      preset: preset.id,
      apiStyle: preset.apiStyle,
      ...preset.authHeader ? { authHeader: preset.authHeader } : {},
      ...preset.authPrefix !== void 0 ? { authPrefix: preset.authPrefix } : {}
    }
  }));
  return [
    ...builtins,
    ...presets2,
    {
      key: "custom:openai",
      label: "OpenAI-compatible endpoint",
      detail: "Any server with /chat/completions and /models \u2014 your own base URL",
      providerId: "custom",
      preset: null,
      apiStyle: "openai-compatible",
      baseUrl: "",
      requiresKey: false,
      badge: "custom",
      config: { apiStyle: "openai-compatible" }
    },
    {
      key: "custom:gemini",
      label: "Gemini-compatible endpoint",
      detail: "Any server with generateContent \u2014 your own base URL",
      providerId: "custom",
      preset: null,
      apiStyle: "gemini",
      baseUrl: "",
      requiresKey: true,
      badge: "custom",
      config: { apiStyle: "gemini", authHeader: "x-goog-api-key", authPrefix: "" }
    }
  ];
}
function stepLabel(step) {
  switch (step) {
    case "name":
      return "Profile name";
    case "baseUrl":
      return "Base URL";
    case "defaultModel":
      return "Default model (optional)";
    case "apiKey":
      return "API key(s), comma-separated for multiple (blank keeps current)";
    case "apiKeyEnv":
      return "Read the key from an environment variable (optional)";
    case "effort":
      return "Reasoning effort";
    default:
      return step;
  }
}
function draftFromProfile(profile) {
  const config = readEndpointConfig(profile);
  return {
    providerId: profile.providerId,
    preset: config.preset ?? null,
    apiStyle: profile.providerId === "gemini" ? "gemini" : config.apiStyle,
    name: profile.name,
    baseUrl: profile.baseUrl,
    defaultModel: profile.defaultModel ?? "",
    apiKey: "",
    apiKeyEnv: profile.apiKeyEnv ?? "",
    access: profile.accessClassification,
    effort: typeof profile.config?.effort === "string" ? profile.config.effort : "default",
    requiresKey: !config.allowNoAuth,
    config: profile.config,
    editingId: profile.id
  };
}
function draftFromKind(option) {
  return {
    providerId: option.providerId,
    preset: option.preset,
    apiStyle: option.apiStyle,
    name: option.preset ? PROVIDER_PRESETS.find((entry) => entry.id === option.preset)?.label ?? option.label : option.label.replace(/^Any /, "Custom ").replace(/ endpoint$/, ""),
    baseUrl: option.baseUrl,
    defaultModel: option.preset ? PROVIDER_PRESETS.find((entry) => entry.id === option.preset)?.exampleModel ?? "" : "",
    apiKey: "",
    apiKeyEnv: "",
    access: "unknown",
    effort: "default",
    requiresKey: option.requiresKey,
    config: option.config,
    editingId: null
  };
}
function validateBaseUrl2(value) {
  if (!value.trim()) return "A base URL is required.";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "Use http:// or https://.";
    return null;
  } catch {
    return "Enter a full URL, for example https://api.example.com/v1.";
  }
}
function lastCheckSucceeded(profile) {
  return Boolean(
    profile.lastSuccessAt && (!profile.lastErrorAt || profile.lastSuccessAt >= profile.lastErrorAt)
  );
}
function ProvidersFrame({
  embedded,
  title,
  subtitle,
  footer,
  children
}) {
  if (embedded) {
    return /* @__PURE__ */ jsx5(
      ModalWindow,
      {
        title,
        subtitle,
        width: 84,
        height: 34,
        footer: footer ?? ["\u2191/\u2193 move", "enter select", "esc back"],
        children
      }
    );
  }
  return /* @__PURE__ */ jsx5(PanelScreen, { title, subtitle, children });
}
function ProvidersScreen({
  context,
  active,
  notify,
  refreshData,
  onStatusChange: _onStatusChange,
  onCycleScreen,
  onBack,
  embedded = false,
  onRequestConnect
}) {
  const { rows, columns } = useLayout();
  const navHint = embedded ? "" : " \u2190/\u2192 or tab screens";
  const backHint = embedded ? "esc close" : "esc back to workspace";
  const [mode, setMode] = useState4({ kind: "list" });
  const [selected, setSelected] = useState4(0);
  const [kindIndex, setKindIndex] = useState4(0);
  const [accessIndex, setAccessIndex] = useState4(0);
  const [effortIndex, setEffortIndex] = useState4(2);
  const [confirmDelete, setConfirmDelete] = useState4(null);
  const [error, setError] = useState4(null);
  const [frame, setFrame] = useState4(0);
  useEffect4(() => {
    if (mode.kind !== "busy") return;
    const timer = setInterval(() => setFrame((value) => value + 1), 120);
    return () => clearInterval(timer);
  }, [mode.kind]);
  const kinds = useMemo3(kindOptions, []);
  const profiles = context.store.listProfiles();
  const storedIds = new Set(getCredentialStore().listSecretIds());
  const current = profiles[Math.min(selected, Math.max(0, profiles.length - 1))] ?? null;
  const startAdd = () => {
    if (onRequestConnect) {
      onRequestConnect();
      return;
    }
    setKindIndex(0);
    setError(null);
    setMode({ kind: "wizard", draft: draftFromKind(kinds[0]), step: "kind" });
  };
  const startEdit = (profile) => {
    const draft = draftFromProfile(profile);
    setAccessIndex(Math.max(0, ACCESS_OPTIONS.indexOf(draft.access)));
    setError(null);
    setMode({ kind: "wizard", draft, step: "name" });
  };
  const advance = (step) => {
    const order = [
      "name",
      "baseUrl",
      "defaultModel",
      "apiKey",
      "apiKeyEnv",
      "access",
      "effort",
      "confirm"
    ];
    const index = order.indexOf(step);
    return order[Math.min(index + 1, order.length - 1)] ?? "confirm";
  };
  const saveDraft = useCallback2(
    async (draft) => {
      setError(null);
      setMode({ kind: "busy", label: draft.editingId ? "Saving profile\u2026" : "Creating profile\u2026" });
      try {
        const definition = getProviderDefinition(draft.providerId);
        if (!draft.name.trim()) throw new Error("A profile name is required.");
        const urlError = validateBaseUrl2(draft.baseUrl);
        if (urlError) throw new Error(urlError);
        const config = endpointConfigForStorage({
          ...draft.config,
          apiStyle: draft.apiStyle,
          preset: draft.preset,
          allowNoAuth: !draft.apiKey.trim() && !draft.apiKeyEnv.trim() ? !draft.requiresKey : false,
          effort: draft.effort
        });
        const authType = draft.providerId === "gemini" || config.authHeader === "x-goog-api-key" ? "api-key" : definition.authType;
        let profile;
        if (draft.editingId) {
          profile = context.store.updateProfile(draft.editingId, {
            name: draft.name.trim(),
            baseUrl: draft.baseUrl.trim(),
            authType,
            defaultModel: draft.defaultModel.trim() || null,
            apiKeyEnv: draft.apiKeyEnv.trim() || null,
            accessClassification: draft.access,
            config
          });
        } else {
          profile = context.store.createProfile({
            providerId: draft.providerId,
            name: draft.name.trim(),
            baseUrl: draft.baseUrl.trim(),
            authType,
            defaultModel: draft.defaultModel.trim() || null,
            apiKeyEnv: draft.apiKeyEnv.trim() || null,
            accessClassification: draft.access,
            config,
            enabled: true
          });
        }
        const credentialId = credentialIdForProfile(profile.id);
        const apiKeys = parseKeyInput(draft.apiKey);
        if (apiKeys.length > 0) {
          for (const entry of apiKeys) registerSecret(entry);
          await getCredentialStore().setSecret(credentialId, keysToSecret(apiKeys));
        }
        if (draft.apiKeyEnv.trim()) {
          await getCredentialStore().deleteSecret(credentialId);
        }
        context.store.clearLimitsForProfile(profile.id);
        if (!context.store.getSelectedProfileId()) context.store.setSelectedProfileId(profile.id);
        setSelected(
          Math.max(
            0,
            context.store.listProfiles().findIndex((entry) => entry.id === profile.id)
          )
        );
        setMode({ kind: "details", profileId: profile.id });
        notify(`${draft.editingId ? "Updated" : "Added"} ${profile.name}.`);
        refreshData();
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : String(saveError));
        setMode({ kind: "wizard", draft, step: "confirm" });
      }
    },
    [context, notify, refreshData]
  );
  const runTest = useCallback2(
    async (profile) => {
      setMode({ kind: "busy", label: `Testing ${profile.name}\u2026` });
      setError(null);
      try {
        const result = await testProfileConnection(context.store, profile);
        notify(
          result.ok ? `${profile.name}: ${result.message} (${result.latencyMs}ms)` : `${profile.name} failed: ${result.message}`
        );
        setMode({ kind: "details", profileId: profile.id });
        refreshData();
      } catch (testError) {
        setError(testError instanceof Error ? testError.message : String(testError));
        setMode({ kind: "details", profileId: profile.id });
      }
    },
    [context, notify, refreshData]
  );
  const runRefresh = useCallback2(
    async (profile) => {
      setMode({ kind: "busy", label: `Refreshing models for ${profile.name}\u2026` });
      setError(null);
      try {
        const result = await refreshProfileModels(context.store, profile);
        notify(`Discovered ${result.discovered} models for ${profile.name}.`);
        const fresh = context.store.getProfile(profile.id);
        if (fresh && !fresh.defaultModel) {
          const models = context.store.listModels(fresh.providerId, fresh.providerId === "custom" ? fresh.id : void 0).filter((model) => model.available).sort((a, b) => b.codingSuitability - a.codingSuitability);
          const best = models[0];
          if (best) context.store.updateProfile(fresh.id, { defaultModel: best.modelId });
        }
        setMode({ kind: "details", profileId: profile.id });
        refreshData();
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
        setMode({ kind: "details", profileId: profile.id });
      }
    },
    [context, notify, refreshData]
  );
  const deleteProfile = useCallback2(
    async (profile) => {
      setMode({ kind: "busy", label: `Deleting ${profile.name}\u2026` });
      try {
        await removeProfile(context.store, profile.id);
        setSelected(0);
        setMode({ kind: "list" });
        notify(`Deleted ${profile.name}.`);
        refreshData();
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
        setMode({ kind: "list" });
      }
    },
    [context, notify, refreshData]
  );
  useInput4(
    (input, key) => {
      if (mode.kind === "busy") return;
      if (key.escape) {
        if (confirmDelete) {
          setConfirmDelete(null);
          return;
        }
        if (mode.kind === "wizard") {
          setMode({ kind: "list" });
          setError(null);
          return;
        }
        if (mode.kind === "details") {
          setMode({ kind: "list" });
          return;
        }
        onBack();
        return;
      }
      if (confirmDelete) {
        const target = profiles.find((profile) => profile.id === confirmDelete);
        if ((input === "y" || input === "Y") && target) {
          setConfirmDelete(null);
          void deleteProfile(target);
        } else if (input === "n" || input === "N") {
          setConfirmDelete(null);
        }
        return;
      }
      if (mode.kind === "list") {
        if (key.leftArrow) {
          onCycleScreen(-1);
          return;
        }
        if (key.rightArrow) {
          onCycleScreen(1);
          return;
        }
        if (key.tab) {
          onCycleScreen(key.shift ? -1 : 1);
          return;
        }
        if (key.upArrow || input === "k") {
          setSelected(
            (value) => profiles.length === 0 ? 0 : (value - 1 + profiles.length) % profiles.length
          );
        } else if (key.downArrow || input === "j") {
          setSelected((value) => profiles.length === 0 ? 0 : (value + 1) % profiles.length);
        } else if (input === "a") startAdd();
        else if (current && input === "e") startEdit(current);
        else if (current && input === "t") void runTest(current);
        else if (current && input === "r") void runRefresh(current);
        else if (current && input === "d") setConfirmDelete(current.id);
        else if (current && input === " ") {
          context.store.updateProfile(current.id, { enabled: !current.enabled });
          refreshData();
        } else if (current && isEnter(input, key))
          setMode({ kind: "details", profileId: current.id });
        return;
      }
      if (mode.kind === "details") {
        const profile = context.store.getProfile(mode.profileId);
        if (!profile) {
          setMode({ kind: "list" });
          return;
        }
        if (key.leftArrow) {
          onCycleScreen(-1);
          return;
        }
        if (key.rightArrow) {
          onCycleScreen(1);
          return;
        }
        if (key.tab) {
          onCycleScreen(key.shift ? -1 : 1);
          return;
        }
        if (isEnter(input, key) || input === "t") void runTest(profile);
        else if (input === "r") void runRefresh(profile);
        else if (input === "e") startEdit(profile);
        else if (input === "d") setConfirmDelete(profile.id);
        else if (input === " ") {
          context.store.updateProfile(profile.id, { enabled: !profile.enabled });
          refreshData();
        }
        return;
      }
      if (mode.kind === "wizard" && mode.step === "kind") {
        if (key.upArrow || input === "k") {
          setKindIndex(
            (value) => kinds.length === 0 ? 0 : (value - 1 + kinds.length) % kinds.length
          );
        } else if (key.downArrow || input === "j") {
          setKindIndex((value) => kinds.length === 0 ? 0 : (value + 1) % kinds.length);
        } else if (isEnter(input, key)) {
          const option = kinds[kindIndex];
          if (option) {
            const draft = draftFromKind(option);
            setAccessIndex(Math.max(0, ACCESS_OPTIONS.indexOf(draft.access)));
            setMode({ kind: "wizard", draft, step: "name" });
          }
        }
        return;
      }
      if (mode.kind === "wizard" && mode.step === "access") {
        if (key.upArrow || input === "k") {
          setAccessIndex(
            (value) => ACCESS_OPTIONS.length === 0 ? 0 : (value - 1 + ACCESS_OPTIONS.length) % ACCESS_OPTIONS.length
          );
        } else if (key.downArrow || input === "j") {
          setAccessIndex(
            (value) => ACCESS_OPTIONS.length === 0 ? 0 : (value + 1) % ACCESS_OPTIONS.length
          );
        } else if (isEnter(input, key)) {
          const access = ACCESS_OPTIONS[accessIndex] ?? "unknown";
          setMode({ kind: "wizard", draft: { ...mode.draft, access }, step: "effort" });
        }
        return;
      }
      if (mode.kind === "wizard" && mode.step === "effort") {
        if (key.upArrow || input === "k") {
          setEffortIndex((value) => (value - 1 + EFFORT_OPTIONS.length) % EFFORT_OPTIONS.length);
        } else if (key.downArrow || input === "j") {
          setEffortIndex((value) => (value + 1) % EFFORT_OPTIONS.length);
        } else if (isEnter(input, key)) {
          const effort = EFFORT_OPTIONS[effortIndex] ?? "default";
          setMode({ kind: "wizard", draft: { ...mode.draft, effort }, step: "confirm" });
        }
        return;
      }
      if (mode.kind === "wizard" && mode.step === "confirm") {
        if (isEnter(input, key)) void saveDraft(mode.draft);
      }
    },
    { isActive: active }
  );
  const listWindow = Math.max(2, Math.floor((rows - 16) / 2));
  const listStart = Math.max(
    0,
    Math.min(selected - Math.floor(listWindow / 2), profiles.length - listWindow)
  );
  const kindWindow = Math.max(6, rows - 20);
  const kindStart = Math.max(
    0,
    Math.min(kindIndex - Math.floor(kindWindow / 2), kinds.length - kindWindow)
  );
  if (mode.kind === "busy") {
    return /* @__PURE__ */ jsx5(ProvidersFrame, { embedded, title: "Providers", subtitle: "working", children: /* @__PURE__ */ jsx5(Spinner, { frame, label: mode.label }) });
  }
  if (mode.kind === "wizard") {
    const draft = mode.draft;
    const isText = TEXT_STEPS.includes(mode.step);
    return /* @__PURE__ */ jsxs5(
      ProvidersFrame,
      {
        embedded,
        title: draft.editingId ? "Edit provider" : "Add provider",
        subtitle: isText ? stepLabel(mode.step) : mode.step,
        footer: ["enter continue", "esc back"],
        children: [
          /* @__PURE__ */ jsx5(Text5, { color: theme.muted, wrap: "wrap", children: "Custom platforms are first-class: any OpenAI-compatible or Gemini-compatible endpoint works." }),
          error ? /* @__PURE__ */ jsx5(Text5, { color: theme.danger, children: error }) : null,
          mode.step === "kind" ? /* @__PURE__ */ jsxs5(Box5, { flexDirection: "column", marginTop: 1, overflow: "hidden", children: [
            /* @__PURE__ */ jsxs5(Text5, { color: theme.faint, wrap: "truncate", children: [
              "  ",
              "Free options are marked. Local endpoints need no key."
            ] }),
            kinds.slice(kindStart, kindStart + kindWindow).map((option, offset) => {
              const index = kindStart + offset;
              const activeRow = index === kindIndex;
              return /* @__PURE__ */ jsxs5(
                Box5,
                {
                  flexDirection: "column",
                  backgroundColor: activeRow ? theme.surfaceAlt : void 0,
                  children: [
                    /* @__PURE__ */ jsxs5(Box5, { children: [
                      /* @__PURE__ */ jsx5(Text5, { color: activeRow ? theme.accent : theme.faint, bold: activeRow, children: activeRow ? `${glyph.active} ` : "  " }),
                      /* @__PURE__ */ jsx5(Text5, { bold: true, color: activeRow ? theme.text : theme.text, children: option.label }),
                      option.badge ? /* @__PURE__ */ jsxs5(Text5, { color: activeRow ? theme.accent : theme.success, children: [
                        "  ",
                        "[",
                        option.badge,
                        "]"
                      ] }) : null
                    ] }),
                    /* @__PURE__ */ jsxs5(Text5, { color: theme.faint, wrap: "truncate", children: [
                      "     ",
                      clip(option.detail, Math.max(20, columns - 12)),
                      option.baseUrl && option.preset ? /* @__PURE__ */ jsx5(Text5, { color: theme.faint, children: `  ${clip(option.baseUrl, 40)}` }) : null
                    ] })
                  ]
                },
                option.key
              );
            }),
            /* @__PURE__ */ jsxs5(Hint, { children: [
              "\u2191/\u2193 choose ",
              glyph.bullet,
              " enter continue ",
              glyph.bullet,
              " esc cancel"
            ] })
          ] }) : null,
          isText ? /* @__PURE__ */ jsxs5(Box5, { flexDirection: "column", marginTop: 1, children: [
            /* @__PURE__ */ jsx5(Text5, { color: theme.muted, children: stepLabel(mode.step) }),
            /* @__PURE__ */ jsx5(
              PromptInput,
              {
                value: String(draft[mode.step] ?? ""),
                mask: mode.step === "apiKey" ? "*" : void 0,
                focus: active,
                placeholder: mode.step === "apiKey" ? "(stored securely; never written to SQLite)" : "",
                onChange: (value) => {
                  setMode({
                    kind: "wizard",
                    draft: { ...draft, [mode.step]: value },
                    step: mode.step
                  });
                },
                onSubmit: (value) => {
                  if (mode.step === "name" && !value.trim()) {
                    setError("A profile name is required.");
                    return;
                  }
                  if (mode.step === "baseUrl") {
                    const urlError = validateBaseUrl2(value);
                    if (urlError) {
                      setError(urlError);
                      return;
                    }
                  }
                  setError(null);
                  const next = advance(mode.step);
                  setMode({
                    kind: "wizard",
                    draft: { ...draft, [mode.step]: value },
                    step: next
                  });
                }
              }
            ),
            /* @__PURE__ */ jsx5(Hint, { children: mode.step === "apiKeyEnv" ? "Leave blank to store a key instead. Environment variables keep secrets out of the database." : "enter continue \xB7 esc cancels without saving" })
          ] }) : null,
          mode.step === "access" ? /* @__PURE__ */ jsxs5(Box5, { flexDirection: "column", marginTop: 1, children: [
            /* @__PURE__ */ jsx5(Text5, { color: theme.muted, children: "How should routing classify this profile?" }),
            ACCESS_OPTIONS.map((access, index) => {
              const activeRow = index === accessIndex;
              return /* @__PURE__ */ jsxs5(
                Text5,
                {
                  color: activeRow ? theme.black : theme.text,
                  backgroundColor: activeRow ? theme.accent : void 0,
                  bold: activeRow,
                  children: [
                    activeRow ? ` ${glyph.active} ` : "   ",
                    access.padEnd(13),
                    /* @__PURE__ */ jsx5(Text5, { color: activeRow ? theme.black : theme.faint, children: access === "unknown" ? " usable, not preferred" : access === "user-free" ? " free for you; preferred fallback" : access === "user-paid" ? " blocked unless allowPaid" : " never routed" })
                  ]
                },
                access
              );
            }),
            /* @__PURE__ */ jsxs5(Hint, { children: [
              "\u2191/\u2193 choose ",
              glyph.bullet,
              " enter continue ",
              glyph.bullet,
              " esc cancel"
            ] })
          ] }) : null,
          mode.step === "effort" ? /* @__PURE__ */ jsxs5(Box5, { flexDirection: "column", marginTop: 1, children: [
            /* @__PURE__ */ jsx5(Text5, { color: theme.muted, wrap: "wrap", children: "How deep should the agent go on this profile? Lower effort uses far fewer tokens." }),
            EFFORT_OPTIONS.map((effort, index) => {
              const activeRow = index === effortIndex;
              return /* @__PURE__ */ jsx5(
                Box5,
                {
                  backgroundColor: activeRow ? theme.surfaceAlt : void 0,
                  flexDirection: "column",
                  children: /* @__PURE__ */ jsxs5(
                    Text5,
                    {
                      color: activeRow ? theme.black : theme.text,
                      backgroundColor: activeRow ? theme.accent : void 0,
                      bold: activeRow,
                      children: [
                        activeRow ? ` ${glyph.active} ` : "   ",
                        effort.padEnd(10),
                        /* @__PURE__ */ jsx5(Text5, { color: activeRow ? theme.black : theme.faint, children: EFFORT_DESCRIPTIONS[effort] })
                      ]
                    }
                  )
                },
                effort
              );
            }),
            /* @__PURE__ */ jsxs5(Hint, { children: [
              "\u2191/\u2193 choose ",
              glyph.bullet,
              " enter continue ",
              glyph.bullet,
              " esc cancel"
            ] })
          ] }) : null,
          mode.step === "confirm" ? /* @__PURE__ */ jsxs5(Box5, { flexDirection: "column", marginTop: 1, children: [
            /* @__PURE__ */ jsx5(
              KeyValue,
              {
                rows: [
                  ["Name", draft.name || "(missing)"],
                  ["Provider", providerDisplayName(draft.providerId)],
                  ["Base URL", draft.baseUrl || "(missing)"],
                  ["Protocol", draft.apiStyle],
                  ["Default model", draft.defaultModel || "(none)"],
                  [
                    "Credential",
                    draft.apiKey ? maskSecret(draft.apiKey) : draft.apiKeyEnv ? `env:${draft.apiKeyEnv}` : "none"
                  ],
                  ["Access", draft.access],
                  ["Effort", draft.effort],
                  [
                    "Discovery",
                    draft.apiStyle === "gemini" || draft.providerId !== "gemini" ? "provider list" : "Gemini list"
                  ]
                ]
              }
            ),
            /* @__PURE__ */ jsx5(Box5, { marginTop: 1, children: /* @__PURE__ */ jsxs5(Text5, { color: theme.muted, children: [
              /* @__PURE__ */ jsx5(Text5, { bold: true, color: theme.accent, children: "enter" }),
              " ",
              "save ",
              /* @__PURE__ */ jsxs5(Text5, { color: theme.faint, children: [
                glyph.bullet,
                " esc cancels"
              ] })
            ] }) }),
            error ? /* @__PURE__ */ jsx5(Text5, { color: theme.danger, children: error }) : null
          ] }) : null
        ]
      }
    );
  }
  if (mode.kind === "details") {
    const profile = context.store.getProfile(mode.profileId);
    if (!profile) {
      return /* @__PURE__ */ jsx5(ProvidersFrame, { embedded, title: "Providers", subtitle: "missing", children: /* @__PURE__ */ jsx5(Text5, { color: theme.muted, children: "This profile no longer exists. Press esc to return." }) });
    }
    const config = readEndpointConfig(profile);
    const models = context.store.listModels(profile.providerId, profile.providerId === "custom" ? profile.id : void 0).filter((model) => model.profileId === null || model.profileId === profile.id);
    const limits2 = context.store.listLimits(true).filter((limit) => limit.profileId === profile.id);
    const keyState = profile.apiKeyEnv ? `env:${profile.apiKeyEnv}` : storedIds.has(credentialIdForProfile(profile.id)) ? "stored securely" : config.allowNoAuth ? "no auth" : "missing";
    return /* @__PURE__ */ jsxs5(
      ProvidersFrame,
      {
        embedded,
        title: profile.name,
        subtitle: providerDisplayName(profile.providerId),
        footer: ["t test", "r refresh", "e edit", "space toggle", "d delete", "esc back"],
        children: [
          error ? /* @__PURE__ */ jsx5(Text5, { color: theme.danger, children: error }) : null,
          /* @__PURE__ */ jsx5(
            KeyValue,
            {
              rows: [
                ["Provider", providerDisplayName(profile.providerId)],
                ["Base URL", profile.baseUrl],
                ["Protocol", profile.providerId === "gemini" ? "gemini" : config.apiStyle],
                ["Credential", keyState],
                ["Default model", profile.defaultModel ?? "\u2014"],
                ["Enabled", profile.enabled ? "yes" : "no"],
                ["Access", profile.accessClassification],
                ["Effort", typeof config.effort === "string" ? config.effort : "default"],
                ["Discovery", config.supportsModelDiscovery ? "yes" : "no"],
                ["Streaming", config.supportsStreaming ? "yes" : "no"],
                ["Models", String(models.length)],
                ["Last success", formatRelative(profile.lastSuccessAt)],
                ["Last error", profile.lastError ? clip(profile.lastError, 70) : "\u2014"],
                ["Active limits", limits2.length ? String(limits2.length) : "none"]
              ],
              width: 18
            }
          ),
          /* @__PURE__ */ jsxs5(Box5, { marginTop: 1, flexDirection: "column", overflow: "hidden", children: [
            /* @__PURE__ */ jsx5(Text5, { bold: true, color: theme.text, children: "Models" }),
            models.slice(0, 6).map((model) => /* @__PURE__ */ jsxs5(Text5, { color: theme.faint, wrap: "truncate", children: [
              "  ",
              model.modelId,
              " [",
              model.access,
              "]"
            ] }, model.id)),
            models.length > 6 ? /* @__PURE__ */ jsxs5(Text5, { color: theme.faint, children: [
              " \u2026 ",
              models.length - 6,
              " more in the model picker"
            ] }) : null
          ] }),
          /* @__PURE__ */ jsx5(Box5, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs5(Text5, { color: theme.muted, wrap: "truncate", children: [
            /* @__PURE__ */ jsx5(Text5, { color: theme.accent, children: "t" }),
            " test ",
            glyph.bullet,
            " ",
            /* @__PURE__ */ jsx5(Text5, { color: theme.accent, children: "r" }),
            " refresh ",
            glyph.bullet,
            " ",
            /* @__PURE__ */ jsx5(Text5, { color: theme.accent, children: "e" }),
            " edit ",
            glyph.bullet,
            " ",
            /* @__PURE__ */ jsx5(Text5, { color: theme.accent, children: "space" }),
            " enable/disable ",
            glyph.bullet,
            " ",
            /* @__PURE__ */ jsx5(Text5, { color: theme.accent, children: "d" }),
            " delete ",
            glyph.bullet,
            " esc back"
          ] }) }),
          /* @__PURE__ */ jsx5(Hint, { children: `esc returns to the profile list${navHint}` })
        ]
      }
    );
  }
  return /* @__PURE__ */ jsxs5(
    ProvidersFrame,
    {
      embedded,
      title: "Providers",
      subtitle: `${profiles.length} configured`,
      footer: [
        "a add",
        "enter details",
        "e edit",
        "t test",
        "r refresh",
        "space toggle",
        "d delete",
        "esc close"
      ],
      children: [
        error ? /* @__PURE__ */ jsx5(Text5, { color: theme.danger, children: error }) : null,
        profiles.length === 0 ? /* @__PURE__ */ jsx5(Empty, { children: "No providers yet. Press a to connect Gemini, Groq, OpenRouter, OpenAI, or any custom platform." }) : /* @__PURE__ */ jsx5(Box5, { flexDirection: "column", marginTop: 1, overflow: "hidden", children: profiles.slice(listStart, listStart + listWindow).map((profile, offset) => {
          const index = listStart + offset;
          const key = profile.apiKeyEnv ? `env:${profile.apiKeyEnv}` : storedIds.has(credentialIdForProfile(profile.id)) ? "key stored" : "no key";
          const activeRow = index === selected;
          return /* @__PURE__ */ jsxs5(Box5, { flexDirection: "column", marginBottom: 1, children: [
            /* @__PURE__ */ jsxs5(Text5, { color: activeRow ? theme.text : theme.muted, children: [
              activeRow ? /* @__PURE__ */ jsxs5(Text5, { color: theme.accent, bold: true, children: [
                glyph.active,
                " "
              ] }) : "  ",
              /* @__PURE__ */ jsx5(Text5, { color: lastCheckSucceeded(profile) ? theme.success : theme.faint, children: lastCheckSucceeded(profile) ? glyph.check : glyph.ring }),
              " ",
              /* @__PURE__ */ jsx5(Text5, { bold: true, color: activeRow ? theme.text : theme.text, children: profile.name }),
              /* @__PURE__ */ jsxs5(Text5, { color: theme.faint, children: [
                " ",
                providerDisplayName(profile.providerId)
              ] }),
              /* @__PURE__ */ jsxs5(Text5, { color: theme.accent, children: [
                " ",
                profile.defaultModel ?? "no default model"
              ] })
            ] }),
            /* @__PURE__ */ jsxs5(Text5, { color: theme.faint, wrap: "truncate", children: [
              "    ",
              clip(profile.baseUrl, Math.max(20, columns - 34)),
              " ",
              glyph.bullet,
              " ",
              key,
              " ",
              glyph.bullet,
              " ",
              profile.accessClassification,
              " ",
              glyph.bullet,
              " ",
              profile.enabled ? "enabled" : "disabled",
              " ",
              glyph.bullet,
              " ",
              formatRelative(profile.lastSuccessAt)
            ] })
          ] }, profile.id);
        }) }),
        confirmDelete ? /* @__PURE__ */ jsxs5(Text5, { color: theme.warning, children: [
          "Delete ",
          profiles.find((profile) => profile.id === confirmDelete)?.name,
          " and its credential? ",
          /* @__PURE__ */ jsx5(Text5, { bold: true, children: "y" }),
          " yes ",
          glyph.bullet,
          " ",
          /* @__PURE__ */ jsx5(Text5, { bold: true, children: "n" }),
          " no"
        ] }) : /* @__PURE__ */ jsx5(Box5, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs5(Text5, { color: theme.muted, wrap: "truncate", children: [
          /* @__PURE__ */ jsx5(Text5, { color: theme.accent, children: "a" }),
          " add ",
          glyph.bullet,
          " ",
          /* @__PURE__ */ jsx5(Text5, { color: theme.accent, children: "enter" }),
          " details ",
          glyph.bullet,
          " ",
          /* @__PURE__ */ jsx5(Text5, { color: theme.accent, children: "e" }),
          " edit ",
          glyph.bullet,
          " ",
          /* @__PURE__ */ jsx5(Text5, { color: theme.accent, children: "t" }),
          " test ",
          glyph.bullet,
          " ",
          /* @__PURE__ */ jsx5(Text5, { color: theme.accent, children: "r" }),
          " refresh ",
          glyph.bullet,
          " ",
          /* @__PURE__ */ jsx5(Text5, { color: theme.accent, children: "space" }),
          " toggle ",
          glyph.bullet,
          " ",
          /* @__PURE__ */ jsx5(Text5, { color: theme.accent, children: "d" }),
          " delete"
        ] }) }),
        /* @__PURE__ */ jsx5(Hint, { children: `\u2191/\u2193 move${navHint} ${glyph.bullet} ${backHint}` })
      ]
    }
  );
}
var FREE_PRESET_IDS, FREE_BUILTIN_IDS, ACCESS_OPTIONS, EFFORT_OPTIONS, EFFORT_DESCRIPTIONS, TEXT_STEPS;
var init_providers2 = __esm({
  "src/tui/screens/providers.tsx"() {
    "use strict";
    init_definitions();
    init_service();
    init_profile_config();
    init_credentials();
    init_redact();
    init_masking();
    init_output();
    init_components();
    init_modal();
    init_theme();
    FREE_PRESET_IDS = /* @__PURE__ */ new Set([
      "cerebras",
      "ollama",
      "lmstudio",
      "vllm",
      "litellm",
      "github-models",
      "huggingface",
      "nvidia-nim",
      "modelscope",
      "gitee-ai",
      "siliconflow",
      "zhipu",
      "cloudflare-workers-ai"
    ]);
    FREE_BUILTIN_IDS = /* @__PURE__ */ new Set(["gemini", "groq", "openrouter"]);
    ACCESS_OPTIONS = ["unknown", "user-free", "user-paid", "unavailable"];
    EFFORT_OPTIONS = ["low", "medium", "default", "high", "xhigh"];
    EFFORT_DESCRIPTIONS = {
      low: "fewest tokens \u2014 tight context, few steps, small tool output",
      medium: "lean \u2014 smaller context budget and fewer agent steps",
      default: "balanced \u2014 uses the global agent settings",
      high: "deeper \u2014 larger context, more steps, bigger tool outputs",
      xhigh: "maximum depth \u2014 largest context and step budget"
    };
    TEXT_STEPS = ["name", "baseUrl", "defaultModel", "apiKey", "apiKeyEnv"];
  }
});

// src/tui/dialogs/providers-dialog.tsx
import "react";
import { jsx as jsx6 } from "react/jsx-runtime";
function ProvidersDialog({
  context,
  onClose,
  notify,
  refreshData,
  onStatusChange,
  onRequestConnect
}) {
  return /* @__PURE__ */ jsx6(
    ProvidersScreen,
    {
      context,
      active: true,
      notify,
      refreshData,
      onStatusChange: onStatusChange ?? (() => {
      }),
      onCycleScreen: () => {
      },
      onBack: onClose,
      embedded: true,
      onRequestConnect
    }
  );
}
var init_providers_dialog = __esm({
  "src/tui/dialogs/providers-dialog.tsx"() {
    "use strict";
    init_providers2();
  }
});

// src/tui/dialogs/selector.tsx
import { useMemo as useMemo4 } from "react";
import { Box as Box6, Text as Text6, useInput as useInput5 } from "ink";
import { Fragment as Fragment2, jsx as jsx7, jsxs as jsxs6 } from "react/jsx-runtime";
function Selector({
  title,
  subtitle,
  items,
  query,
  onQueryChange,
  selected,
  onSelectedChange,
  onSelect,
  onClose,
  onKey,
  searchPlaceholder = "Search\u2026",
  emptyText = "No matches.",
  footer = ["\u2191\u2193 navigate", "enter select", "esc close"],
  showSearch = true,
  accent: accent2 = theme.accent,
  maxVisible,
  floating = true
}) {
  const { rows, columns } = useLayout();
  const safeSelected = Math.min(Math.max(0, selected), Math.max(0, items.length - 1));
  const current = items[safeSelected] ?? null;
  const move = (direction) => {
    if (items.length === 0) return;
    let index = safeSelected;
    for (let attempt = 0; attempt < items.length; attempt += 1) {
      index = (index + direction + items.length) % items.length;
      if (!items[index]?.disabled) {
        onSelectedChange(index);
        return;
      }
    }
  };
  useInput5(
    (input, key) => {
      if (isMouseSequence(input) || isSuppressedInput()) return;
      if (onKey?.(input, key, current)) return;
      if (key.escape) {
        onClose();
        return;
      }
      if (key.upArrow) {
        move(-1);
        return;
      }
      if (key.downArrow) {
        move(1);
        return;
      }
      if (key.pageUp) {
        onSelectedChange(Math.max(0, safeSelected - 6));
        return;
      }
      if (key.pageDown) {
        onSelectedChange(Math.min(Math.max(0, items.length - 1), safeSelected + 6));
        return;
      }
      if (key.return || input === "\r" || input === "\n") {
        if (current && !current.disabled) onSelect(current);
        return;
      }
      if (!showSearch) return;
      if (key.backspace || key.delete) {
        onQueryChange([...query].slice(0, -1).join(""));
        return;
      }
      if (key.ctrl || key.meta || key.tab) return;
      if (!input) return;
      const clean = Array.from(input).filter((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code >= 32 && code !== 127;
      }).join("");
      if (clean) onQueryChange(query + clean);
    },
    { isActive: true }
  );
  const displayRows = useMemo4(() => {
    const result = [];
    let previousGroup;
    items.forEach((item, index) => {
      if (item.group && item.group !== previousGroup) {
        result.push({ kind: "group", label: item.group });
        previousGroup = item.group;
      }
      result.push({ kind: "item", item, index });
    });
    return result;
  }, [items]);
  const selectedRow = Math.max(
    0,
    displayRows.findIndex((row) => row.kind === "item" && row.index === safeSelected)
  );
  const modalWidth = Math.max(36, Math.min(columns - 4, 72));
  const modalHeight = Math.max(8, Math.min(rows - 4, 20));
  const height = Math.max(4, maxVisible ?? (floating ? modalHeight - 9 : rows - 12));
  const rowCost = (row) => row.kind === "group" ? 1 : row.item.detail ? 2 : 1;
  const costs = displayRows.map(rowCost);
  let start = selectedRow;
  let used = costs[selectedRow] ?? 1;
  while (start > 0 && used + (costs[start - 1] ?? 0) <= height) {
    start -= 1;
    used += costs[start] ?? 0;
  }
  let end = selectedRow;
  while (end + 1 < displayRows.length && used + (costs[end + 1] ?? 0) <= height) {
    end += 1;
    used += costs[end] ?? 0;
  }
  while (start > 0 && used + (costs[start - 1] ?? 0) <= height) {
    start -= 1;
    used += costs[start] ?? 0;
  }
  while (end > selectedRow && used + (start > 0 ? 1 : 0) + (end + 1 < displayRows.length ? 1 : 0) > height) {
    used -= costs[end] ?? 0;
    end -= 1;
  }
  const visible = displayRows.slice(start, end + 1);
  const remainingAbove = start;
  const remainingBelow = Math.max(0, displayRows.length - (end + 1));
  const content = /* @__PURE__ */ jsxs6(
    Box6,
    {
      width: floating ? modalWidth : void 0,
      height: floating ? modalHeight : void 0,
      flexGrow: floating ? void 0 : 1,
      flexDirection: "column",
      borderStyle: "round",
      borderColor: accent2,
      backgroundColor: theme.surface,
      paddingX: 1,
      overflow: "hidden",
      children: [
        /* @__PURE__ */ jsxs6(Box6, { justifyContent: "space-between", flexShrink: 0, children: [
          /* @__PURE__ */ jsxs6(Text6, { bold: true, color: theme.text, wrap: "truncate", children: [
            /* @__PURE__ */ jsxs6(Text6, { color: accent2, children: [
              glyph.brand,
              " "
            ] }),
            title
          ] }),
          /* @__PURE__ */ jsxs6(Text6, { color: theme.faint, wrap: "truncate", children: [
            subtitle ? `${subtitle}  ` : "",
            items.length,
            " ",
            items.length === 1 ? "result" : "results"
          ] })
        ] }),
        showSearch ? /* @__PURE__ */ jsxs6(Box6, { flexShrink: 0, marginTop: 1, children: [
          /* @__PURE__ */ jsxs6(Text6, { color: theme.faint, children: [
            glyph.prompt,
            " "
          ] }),
          query ? /* @__PURE__ */ jsxs6(Text6, { color: theme.text, wrap: "truncate", children: [
            query,
            /* @__PURE__ */ jsx7(Text6, { color: accent2, children: "\u258C" })
          ] }) : /* @__PURE__ */ jsxs6(Text6, { color: theme.faint, wrap: "truncate", children: [
            searchPlaceholder,
            /* @__PURE__ */ jsx7(Text6, { color: accent2, children: "\u258C" })
          ] })
        ] }) : null,
        /* @__PURE__ */ jsx7(Box6, { flexDirection: "column", flexGrow: 1, overflow: "hidden", marginTop: 1, children: items.length === 0 ? /* @__PURE__ */ jsx7(Text6, { color: theme.muted, wrap: "wrap", children: emptyText }) : /* @__PURE__ */ jsxs6(Fragment2, { children: [
          remainingAbove > 0 ? /* @__PURE__ */ jsxs6(Text6, { color: theme.faint, children: [
            glyph.arrowUp,
            " ",
            remainingAbove,
            " more"
          ] }) : null,
          visible.map((row, offset) => {
            if (row.kind === "group") {
              return /* @__PURE__ */ jsx7(Text6, { color: theme.faint, bold: true, children: row.label.toUpperCase() }, `group-${row.label}-${start + offset}`);
            }
            const active = row.index === safeSelected && !row.item.disabled;
            return /* @__PURE__ */ jsxs6(Box6, { flexDirection: "column", flexShrink: 0, children: [
              /* @__PURE__ */ jsx7(Box6, { children: /* @__PURE__ */ jsxs6(
                Text6,
                {
                  color: active ? theme.black : row.item.disabled ? theme.faint : theme.text,
                  backgroundColor: active ? accent2 : void 0,
                  bold: active,
                  wrap: "truncate",
                  children: [
                    active ? ` ${glyph.active} ` : "   ",
                    row.item.leadingBadge ? /* @__PURE__ */ jsxs6(
                      Text6,
                      {
                        bold: true,
                        color: active ? theme.black : row.item.leadingBadgeColor ?? theme.success,
                        children: [
                          row.item.leadingBadge,
                          " "
                        ]
                      }
                    ) : null,
                    /* @__PURE__ */ jsx7(Text6, { bold: active, children: row.item.label }),
                    row.item.badge ? /* @__PURE__ */ jsxs6(Text6, { color: active ? theme.black : row.item.badgeColor ?? theme.muted, children: [
                      "  ",
                      row.item.badge
                    ] }) : null,
                    "  "
                  ]
                }
              ) }),
              row.item.detail ? /* @__PURE__ */ jsxs6(Text6, { color: active ? theme.muted : theme.faint, wrap: "truncate", children: [
                "     ",
                row.item.detail
              ] }) : null
            ] }, row.item.key);
          }),
          remainingBelow > 0 ? /* @__PURE__ */ jsxs6(Text6, { color: theme.faint, children: [
            glyph.arrowDown,
            " ",
            remainingBelow,
            " more"
          ] }) : null
        ] }) }),
        /* @__PURE__ */ jsxs6(Box6, { flexShrink: 0, marginTop: 1, justifyContent: "space-between", children: [
          /* @__PURE__ */ jsx7(Text6, { color: theme.faint, wrap: "truncate", children: footer.join(`  ${glyph.bullet}  `) }),
          /* @__PURE__ */ jsx7(Text6, { color: theme.faint, children: columns < 80 ? "" : `${columns} cols` })
        ] })
      ]
    }
  );
  if (!floating) return content;
  return /* @__PURE__ */ jsx7(
    Box6,
    {
      position: "absolute",
      top: 0,
      left: 0,
      width: columns,
      height: rows,
      justifyContent: "center",
      alignItems: "center",
      children: content
    }
  );
}
function filterByQuery(items, query, fields) {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => fields(item).some((field) => field.toLowerCase().includes(needle)));
}
var init_selector = __esm({
  "src/tui/dialogs/selector.tsx"() {
    "use strict";
    init_theme();
    init_components();
    init_mouse();
  }
});

// src/tui/dialogs/model-picker.tsx
import { useCallback as useCallback3, useEffect as useEffect5, useMemo as useMemo5, useState as useState5 } from "react";
import { Box as Box7, Text as Text7 } from "ink";
import { jsx as jsx8, jsxs as jsxs7 } from "react/jsx-runtime";
function accessColor(access) {
  if (access === "free-confirmed" || access === "user-free") return theme.success;
  if (access === "free-tier") return theme.accent;
  if (access === "paid" || access === "user-paid") return theme.warning;
  if (access === "unavailable") return theme.danger;
  return theme.muted;
}
function contextLabel(model) {
  return model.contextWindow ? `${formatCount(model.contextWindow)} ctx` : "ctx unknown";
}
function ModelPicker({
  context,
  onClose,
  onSelected,
  notify,
  refreshData,
  initialQuery = ""
}) {
  const [query, setQuery] = useState5(initialQuery);
  const [selected, setSelected] = useState5(0);
  const [freeOnly, setFreeOnly] = useState5(false);
  const [toolsOnly, setToolsOnly] = useState5(false);
  const [availableOnly, setAvailableOnly] = useState5(true);
  const [providerFilter, setProviderFilter] = useState5(null);
  const [manualMode, setManualMode] = useState5(false);
  const [manualValue, setManualValue] = useState5("");
  const [busy, setBusy] = useState5(null);
  const [error, setError] = useState5(null);
  const [version, setVersion] = useState5(0);
  const profiles = context.store.listProfiles();
  const allowPaid = context.store.getSettings().routing.allowPaid;
  const providers = useMemo5(
    () => [...new Set(profiles.map((profile) => profile.providerId))],
    [profiles]
  );
  const currentSelectedKey = context.store.getSelectedModelId();
  const models = useMemo5(() => {
    let entries = context.store.listModels().filter((model) => profiles.some((profile) => profile.providerId === model.providerId));
    if (providerFilter) entries = entries.filter((model) => model.providerId === providerFilter);
    if (availableOnly) entries = entries.filter((model) => model.available);
    if (toolsOnly) entries = entries.filter((model) => model.supportsTools);
    if (freeOnly) {
      entries = entries.filter(
        (model) => isFreeAccess(
          effectiveAccess(
            model,
            owningProfileForModel(profiles, model)?.accessClassification ?? null
          )
        )
      );
    }
    const accessOf = (model) => effectiveAccess(model, owningProfileForModel(profiles, model)?.accessClassification ?? null);
    if (!allowPaid) entries = entries.filter((model) => !isPaidAccess(accessOf(model)));
    entries = filterByQuery(entries, query, (model) => [
      model.modelId,
      model.displayName,
      providerDisplayName(model.providerId),
      owningProfileForModel(profiles, model)?.name ?? "",
      ACCESS_LABELS[effectiveAccess(model, owningProfileForModel(profiles, model)?.accessClassification ?? null)]
    ]);
    const accessRank = (model) => {
      const access = accessOf(model);
      if (isFreeAccess(access)) return 0;
      if (access === "unknown") return 1;
      return 2;
    };
    const groupOf = (model) => {
      const owner = owningProfileForModel(profiles, model);
      return model.providerId === "custom" && owner ? owner.name : providerDisplayName(model.providerId);
    };
    return entries.sort(
      (left, right) => groupOf(left).localeCompare(groupOf(right)) || accessRank(left) - accessRank(right) || right.codingSuitability - left.codingSuitability || left.modelId.localeCompare(right.modelId)
    );
  }, [
    context,
    profiles,
    providerFilter,
    availableOnly,
    toolsOnly,
    freeOnly,
    allowPaid,
    query,
    version
  ]);
  useEffect5(() => {
    setSelected((value) => Math.min(value, Math.max(0, models.length - 1)));
  }, [models.length]);
  const current = models[Math.min(selected, Math.max(0, models.length - 1))] ?? null;
  const items = useMemo5(
    () => models.map((model) => {
      const profile = owningProfileForModel(profiles, model);
      const access = effectiveAccess(model, profile?.accessClassification ?? null);
      const free = isFreeAccess(access);
      const isSelected = model.id === currentSelectedKey;
      const group = model.providerId === "custom" && profile ? profile.name : providerDisplayName(model.providerId);
      const capabilities = [
        model.supportsTools ? "tools" : "no tools",
        model.supportsVision ? "vision" : null,
        model.supportsStreaming ? "stream" : null
      ].filter(Boolean);
      const accessBadge = access === "free-confirmed" || access === "user-free" ? "free" : access === "free-tier" ? "free tier" : isPaidAccess(access) ? "paid" : access === "unknown" ? "unknown" : null;
      return {
        key: model.id,
        label: `${isSelected ? `${glyph.dot} ` : ""}${model.displayName || model.modelId}`,
        group,
        leadingBadge: accessBadge ?? void 0,
        leadingBadgeColor: accessBadge === "free" ? theme.success : accessBadge === "paid" ? theme.warning : accessBadge === "free tier" ? theme.accent : theme.muted,
        badge: free ? model.available ? void 0 : "unavailable" : `${ACCESS_LABELS[access]}${model.available ? "" : " \xB7 unavailable"}`,
        badgeColor: accessColor(access),
        detail: `${group} ${glyph.bullet} ${profile?.name ?? "no profile"} ${glyph.bullet} id ${model.modelId} ${glyph.bullet} ${contextLabel(model)} ${glyph.bullet} ${capabilities.join("/")} ${glyph.bullet} ${model.available ? "available" : "not verified"}${isSelected ? ` ${glyph.bullet} selected` : ""}`,
        disabled: access === "unavailable",
        disabledReason: "This model is classified as unavailable."
      };
    }),
    [models, profiles, currentSelectedKey]
  );
  const selectModel2 = useCallback3(
    async (model) => {
      const profile = owningProfileForModel(profiles, model);
      context.store.setSelectedModelId(model.id);
      if (profile) context.store.setSelectedProfileId(profile.id);
      notify(`Using ${model.modelId}${profile ? ` via ${profile.name}` : ""}.`);
      refreshData();
      onSelected?.(model, profile);
      onClose();
    },
    [context, notify, onClose, onSelected, profiles, refreshData]
  );
  const setDefault = useCallback3(
    (model) => {
      const profile = owningProfileForModel(profiles, model);
      if (!profile) {
        notify("No profile owns this model.");
        return;
      }
      context.store.updateProfile(profile.id, { defaultModel: model.modelId });
      notify(`Default model for ${profile.name} is now ${model.modelId}.`);
      refreshData();
      setVersion((value) => value + 1);
    },
    [context, notify, profiles, refreshData]
  );
  const refresh = useCallback3(async () => {
    const enabled = profiles.filter((profile) => profile.enabled);
    if (enabled.length === 0) {
      setError("Connect or enable a provider profile first.");
      return;
    }
    setBusy("Refreshing model catalogs\u2026");
    setError(null);
    let discovered = 0;
    const failures = [];
    for (const profile of enabled) {
      try {
        const result = await refreshProfileModels(context.store, profile);
        discovered += result.discovered;
      } catch (refreshError) {
        failures.push(
          `${profile.name}: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`
        );
      }
    }
    setBusy(null);
    setVersion((value) => value + 1);
    refreshData();
    if (failures.length) {
      setError(
        `Refreshed ${discovered} models. ${failures.length} profile(s) failed: ${failures[0]}`
      );
    } else {
      notify(`Refreshed ${discovered} models across ${enabled.length} profile(s).`);
    }
  }, [context, notify, profiles, refreshData]);
  const saveManual = useCallback3(async () => {
    const value = manualValue.trim();
    if (!value) {
      setError("Enter a model id.");
      return;
    }
    const profile = (current ? owningProfileForModel(profiles, current) : null) ?? profiles.find((entry) => entry.id === context.store.getSelectedProfileId()) ?? profiles.find((entry) => entry.enabled) ?? profiles[0];
    if (!profile) {
      setError("Connect a provider profile before adding a manual model.");
      return;
    }
    setBusy("Adding model\u2026");
    setError(null);
    try {
      await addManualModel(context.store, profile, value);
      const added = context.store.listModels().find(
        (model) => model.modelId === value && (profile.providerId === "custom" ? model.profileId === profile.id : model.providerId === profile.providerId)
      ) ?? null;
      setManualMode(false);
      setManualValue("");
      setVersion((current2) => current2 + 1);
      refreshData();
      if (added) await selectModel2(added);
      else {
        notify(`Added ${value} to ${profile.name}.`);
        onClose();
      }
    } catch (manualError) {
      setError(manualError instanceof Error ? manualError.message : String(manualError));
    } finally {
      setBusy(null);
    }
  }, [context, current, manualValue, notify, onClose, profiles, refreshData, selectModel2]);
  if (manualMode) {
    return /* @__PURE__ */ jsxs7(
      ModalWindow,
      {
        title: "ADD A MODEL ID MANUALLY",
        subtitle: "Catalog override",
        width: 68,
        height: 14,
        footer: ["enter add", "esc cancel"],
        children: [
          /* @__PURE__ */ jsx8(Text7, { color: theme.muted, wrap: "wrap", children: "Use this when a provider's model-list endpoint is unavailable. The id is stored in the catalog for the selected profile." }),
          /* @__PURE__ */ jsx8(Box7, { marginTop: 1, children: /* @__PURE__ */ jsx8(
            PromptInput,
            {
              value: manualValue,
              onChange: setManualValue,
              onSubmit: () => void saveManual(),
              focus: true,
              placeholder: "provider/model-id"
            }
          ) }),
          error ? /* @__PURE__ */ jsx8(Text7, { color: theme.danger, wrap: "wrap", children: error }) : null,
          busy ? /* @__PURE__ */ jsx8(Text7, { color: theme.accent, children: busy }) : null
        ]
      }
    );
  }
  return /* @__PURE__ */ jsx8(
    Selector,
    {
      title: "Select model",
      subtitle: busy ?? `${providerFilter ? providerDisplayName(providerFilter) : "all providers"}${freeOnly ? " \xB7 free" : ""}${toolsOnly ? " \xB7 tools" : ""}${availableOnly ? " \xB7 available" : ""}${allowPaid ? "" : " \xB7 paid hidden"}`,
      items,
      query,
      onQueryChange: (value) => {
        setQuery(value);
        setSelected(0);
      },
      selected,
      onSelectedChange: setSelected,
      onSelect: (item) => {
        const model = models.find((entry) => entry.id === item.key);
        if (model) void selectModel2(model);
      },
      onClose,
      onKey: (input, key) => {
        if (busy) return true;
        if (key.ctrl && input === "f") {
          setFreeOnly((value) => !value);
          setSelected(0);
          return true;
        }
        if (key.ctrl && input === "t") {
          setToolsOnly((value) => !value);
          setSelected(0);
          return true;
        }
        if (key.ctrl && input === "a") {
          setAvailableOnly((value) => !value);
          setSelected(0);
          return true;
        }
        if (key.ctrl && input === "p") {
          const index = providerFilter ? providers.indexOf(providerFilter) : -1;
          const next = index + 1 >= providers.length ? null : providers[index + 1] ?? null;
          setProviderFilter(next);
          setSelected(0);
          return true;
        }
        if (key.ctrl && input === "r") {
          void refresh();
          return true;
        }
        if (key.ctrl && input === "e") {
          setManualMode(true);
          return true;
        }
        if (key.ctrl && input === "d") {
          if (current) setDefault(current);
          return true;
        }
        return false;
      },
      searchPlaceholder: "Search models by name, id, provider, or access\u2026",
      emptyText: profiles.length === 0 ? "No provider profiles are connected. Run /connect first." : "No models match the current search and filters.",
      footer: [
        "\u2191\u2193 navigate",
        "enter select",
        "ctrl+f free",
        "ctrl+t tools",
        "ctrl+a available",
        "ctrl+p provider",
        "ctrl+r refresh",
        "ctrl+e manual",
        "ctrl+d default",
        allowPaid ? "paid: on (/allow-paid)" : "paid: off (/allow-paid)",
        "esc close"
      ]
    }
  );
}
var init_model_picker = __esm({
  "src/tui/dialogs/model-picker.tsx"() {
    "use strict";
    init_catalog();
    init_definitions();
    init_service();
    init_components();
    init_theme();
    init_selector();
    init_modal();
  }
});

// src/tui/dialogs/connect-dialog.tsx
import { useEffect as useEffect6, useState as useState6, useMemo as useMemo6 } from "react";
import { Box as Box8, Text as Text8, useInput as useInput6 } from "ink";
import { randomUUID as randomUUID4 } from "crypto";
import { jsx as jsx9, jsxs as jsxs8 } from "react/jsx-runtime";
function ConnectDialog({
  context,
  onClose,
  onConnected,
  notify,
  refreshData
}) {
  const [step, setStep] = useState6("select-provider");
  const [providerIndex, setProviderIndex] = useState6(0);
  const [providerQuery, setProviderQuery] = useState6("");
  const [selectedProvider, setSelectedProvider] = useState6(PROVIDER_CHOICES[0]);
  const [fieldIndex, setFieldIndex] = useState6(0);
  const [name, setName] = useState6("");
  const [apiKey, setApiKey] = useState6("");
  const [baseUrl, setBaseUrl] = useState6("");
  const [defaultModel, setDefaultModel2] = useState6("");
  const [testResult, setTestResult] = useState6(null);
  const [statusMessage, setStatusMessage] = useState6(null);
  const [saving, setSaving] = useState6(false);
  const [spinFrame, setSpinFrame] = useState6(0);
  useEffect6(() => {
    if (!statusMessage) return;
    const timer = setInterval(() => setSpinFrame((frame) => frame + 1), 120);
    return () => clearInterval(timer);
  }, [statusMessage]);
  const existingProfiles = useMemo6(() => context.store.listProfiles(), [context, step]);
  const providerItems = useMemo6(() => {
    const items = PROVIDER_CHOICES.map((choice) => {
      const connected = existingProfiles.filter((p) => p.providerId === choice.kind);
      const countBadge = connected.length > 0 ? `${connected.length} connected` : choice.kind === "custom" ? "custom" : "not connected";
      const connectedNames = connected.map((p) => p.name).join(", ");
      return {
        key: choice.kind,
        label: choice.label,
        detail: `${choice.detail}${connectedNames ? ` \xB7 profiles: ${connectedNames}` : ""}`,
        badge: countBadge,
        badgeColor: connected.length > 0 ? theme.success : theme.faint
      };
    });
    return filterByQuery(items, providerQuery, (item) => [item.label, item.detail ?? ""]);
  }, [existingProfiles, providerQuery]);
  const handleSelectProvider = (item) => {
    const choice = PROVIDER_CHOICES.find((c) => c.kind === item.key) ?? PROVIDER_CHOICES[0];
    setSelectedProvider(choice);
    const existingSameKind = existingProfiles.filter((p) => p.providerId === choice.kind);
    const defaultName = existingSameKind.length === 0 ? "Default" : existingSameKind.length === 1 ? "Work" : `Profile-${existingSameKind.length + 1}`;
    setName(defaultName);
    setBaseUrl(choice.defaultBaseUrl);
    setDefaultModel2(choice.defaultModel);
    setApiKey("");
    setTestResult(null);
    setStatusMessage(null);
    setFieldIndex(choice.requiresKey ? 1 : 0);
    setStep("configure-profile");
  };
  const handleTestConnection = async () => {
    if (selectedProvider.requiresKey && !apiKey.trim()) {
      setTestResult({ ok: false, message: "API key is required for testing." });
      return false;
    }
    setStatusMessage("Testing connection\u2026");
    setTestResult(null);
    let passed = false;
    const temporaryProfileId = `test-${randomUUID4()}`;
    let temporaryCredentialId = null;
    try {
      const dummyProfile = {
        id: temporaryProfileId,
        providerId: selectedProvider.kind,
        name: name.trim() || "Test",
        baseUrl: baseUrl.trim() || selectedProvider.defaultBaseUrl,
        authType: selectedProvider.requiresKey ? "api-key" : "bearer",
        defaultModel: defaultModel.trim() || selectedProvider.defaultModel,
        accessClassification: "unknown",
        enabled: true,
        apiKeyEnv: null,
        lastSuccessAt: null,
        lastError: null,
        lastErrorAt: null,
        lastCheckedAt: null,
        modelsRefreshedAt: null,
        config: {
          apiStyle: selectedProvider.apiStyle,
          allowNoAuth: !selectedProvider.requiresKey
        },
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      const tempKeys = parseKeyInput(apiKey);
      if (tempKeys.length > 0) {
        for (const entry of tempKeys) registerSecret(entry);
        temporaryCredentialId = credentialIdForProfile(dummyProfile.id);
        await getCredentialStore().setSecret(temporaryCredentialId, keysToSecret(tempKeys));
      }
      const res = await testProfileConnection(context.store, dummyProfile, {
        persistStatus: false
      });
      if (res.ok) {
        passed = true;
        setTestResult({
          ok: true,
          message: res.message || `Connected successfully (${res.modelCount ?? 0} models discovered).`
        });
      } else {
        setTestResult({
          ok: false,
          message: res.message || "Connection failed."
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err)
      });
    } finally {
      if (temporaryCredentialId) {
        try {
          await getCredentialStore().deleteSecret(temporaryCredentialId);
        } catch (cleanupError) {
          passed = false;
          setTestResult({
            ok: false,
            message: `Connection test finished, but temporary credential cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
          });
        }
      }
      setStatusMessage(null);
    }
    return passed;
  };
  const handleSave = async () => {
    const finalName = name.trim();
    if (!finalName) {
      setTestResult({ ok: false, message: "Profile name cannot be empty." });
      return;
    }
    if (selectedProvider.requiresKey && !apiKey.trim()) {
      setTestResult({ ok: false, message: "API key is required." });
      return;
    }
    if (saving) return;
    setSaving(true);
    setStatusMessage("Saving provider and discovering models\u2026");
    setTestResult(null);
    try {
      const profile = context.store.createProfile({
        providerId: selectedProvider.kind,
        name: finalName,
        baseUrl: baseUrl.trim() || selectedProvider.defaultBaseUrl,
        authType: selectedProvider.requiresKey ? "api-key" : "bearer",
        defaultModel: defaultModel.trim() || selectedProvider.defaultModel,
        accessClassification: selectedProvider.kind === "gemini" || selectedProvider.kind === "groq" ? "free-tier" : "unknown",
        enabled: true,
        config: {
          apiStyle: selectedProvider.apiStyle,
          allowNoAuth: !selectedProvider.requiresKey
        }
      });
      const finalKeys = parseKeyInput(apiKey);
      if (finalKeys.length > 0) {
        for (const entry of finalKeys) registerSecret(entry);
        const credStore = getCredentialStore();
        await credStore.setSecret(credentialIdForProfile(profile.id), keysToSecret(finalKeys));
      }
      try {
        const result = await refreshProfileModels(context.store, profile);
        const fresh = context.store.getProfile(profile.id);
        if (fresh && (!fresh.defaultModel || result.discovered > 0)) {
          const models = context.store.listModels(fresh.providerId, fresh.providerId === "custom" ? fresh.id : void 0).filter((model) => model.available);
          const ranked = models.sort((left, right) => {
            const leftFree = isFreeAccess(effectiveAccess(left, fresh.accessClassification));
            const rightFree = isFreeAccess(effectiveAccess(right, fresh.accessClassification));
            if (leftFree !== rightFree) return leftFree ? -1 : 1;
            return right.codingSuitability - left.codingSuitability;
          });
          const preferred = ranked[0];
          if (preferred && !fresh.defaultModel) {
            context.store.updateProfile(fresh.id, { defaultModel: preferred.modelId });
          }
        }
      } catch {
      }
      context.store.clearLimitsForProfile(profile.id);
      if (!context.store.getSelectedProfileId() || existingProfiles.length === 0) {
        context.store.setSelectedProfileId(profile.id);
      }
      notify(`Connected ${profile.name} (${providerDisplayName(profile.providerId)}).`);
      refreshData();
      onConnected(profile);
      onClose();
    } catch (err) {
      setStatusMessage(null);
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setSaving(false);
    }
  };
  useInput6(
    (input, key) => {
      if (step !== "configure-profile") return;
      if (key.escape) {
        setStep("select-provider");
        return;
      }
      if (key.tab) {
        setFieldIndex((cur) => (cur + (key.shift ? -1 : 1) + 4) % 4);
        return;
      }
      if (key.ctrl && input === "t") {
        void handleTestConnection();
        return;
      }
      if (key.ctrl && input === "s") {
        void handleSave();
        return;
      }
    },
    { isActive: step === "configure-profile" }
  );
  if (step === "select-provider") {
    return /* @__PURE__ */ jsx9(
      Selector,
      {
        title: "CONNECT PROVIDER",
        subtitle: "pick a provider to connect",
        items: providerItems,
        query: providerQuery,
        onQueryChange: (value) => {
          setProviderQuery(value);
          setProviderIndex(0);
        },
        selected: providerIndex,
        onSelectedChange: setProviderIndex,
        onSelect: handleSelectProvider,
        onClose,
        searchPlaceholder: "Filter providers\u2026",
        footer: ["\u2191\u2193 navigate", "enter select", "esc close"]
      }
    );
  }
  return /* @__PURE__ */ jsxs8(
    ModalWindow,
    {
      title: `CONNECT ${selectedProvider.label.toUpperCase()}`,
      subtitle: "Configure profile",
      width: 72,
      height: 20,
      borderColor: theme.accent,
      footer: ["tab next field", "ctrl+t test", "ctrl+s save", "esc back"],
      children: [
        /* @__PURE__ */ jsxs8(Box8, { flexDirection: "column", marginTop: 1, flexGrow: 1, children: [
          /* @__PURE__ */ jsxs8(Box8, { marginBottom: 1, children: [
            /* @__PURE__ */ jsxs8(Text8, { color: fieldIndex === 0 ? theme.accent : theme.faint, bold: fieldIndex === 0, children: [
              fieldIndex === 0 ? `\u25B8 ` : `  `,
              "Profile name:"
            ] }),
            /* @__PURE__ */ jsx9(Box8, { marginLeft: 2, flexGrow: 1, children: /* @__PURE__ */ jsx9(
              PromptInput,
              {
                value: name,
                onChange: setName,
                onSubmit: () => setFieldIndex(1),
                focus: fieldIndex === 0,
                placeholder: "e.g. Personal, Work, Backup"
              }
            ) })
          ] }),
          /* @__PURE__ */ jsxs8(Box8, { marginBottom: 1, children: [
            /* @__PURE__ */ jsxs8(Text8, { color: fieldIndex === 1 ? theme.accent : theme.faint, bold: fieldIndex === 1, children: [
              fieldIndex === 1 ? `\u25B8 ` : `  `,
              "API key:"
            ] }),
            /* @__PURE__ */ jsx9(Box8, { marginLeft: 2, flexGrow: 1, children: fieldIndex === 1 ? /* @__PURE__ */ jsx9(
              PromptInput,
              {
                value: apiKey,
                onChange: setApiKey,
                onSubmit: () => setFieldIndex(2),
                focus: fieldIndex === 1,
                mask: "*",
                placeholder: selectedProvider.requiresKey ? "Paste API key(s), comma-separate for multiple (masked)" : "Optional"
              }
            ) : /* @__PURE__ */ jsx9(Text8, { color: apiKey ? theme.muted : theme.faint, children: apiKey ? `${maskSecret(apiKey)} (hidden)` : "(none)" }) })
          ] }),
          /* @__PURE__ */ jsxs8(Box8, { marginBottom: 1, children: [
            /* @__PURE__ */ jsxs8(Text8, { color: fieldIndex === 2 ? theme.accent : theme.faint, bold: fieldIndex === 2, children: [
              fieldIndex === 2 ? `\u25B8 ` : `  `,
              "Base URL:"
            ] }),
            /* @__PURE__ */ jsx9(Box8, { marginLeft: 2, flexGrow: 1, children: /* @__PURE__ */ jsx9(
              PromptInput,
              {
                value: baseUrl,
                onChange: setBaseUrl,
                onSubmit: () => setFieldIndex(3),
                focus: fieldIndex === 2,
                placeholder: selectedProvider.defaultBaseUrl
              }
            ) })
          ] }),
          /* @__PURE__ */ jsxs8(Box8, { marginBottom: 1, children: [
            /* @__PURE__ */ jsxs8(Text8, { color: fieldIndex === 3 ? theme.accent : theme.faint, bold: fieldIndex === 3, children: [
              fieldIndex === 3 ? `\u25B8 ` : `  `,
              "Default model:"
            ] }),
            /* @__PURE__ */ jsx9(Box8, { marginLeft: 2, flexGrow: 1, children: /* @__PURE__ */ jsx9(
              PromptInput,
              {
                value: defaultModel,
                onChange: setDefaultModel2,
                onSubmit: () => void handleSave(),
                focus: fieldIndex === 3,
                placeholder: selectedProvider.defaultModel
              }
            ) })
          ] }),
          statusMessage ? /* @__PURE__ */ jsx9(Box8, { marginY: 1, children: /* @__PURE__ */ jsx9(Spinner, { frame: spinFrame, label: statusMessage }) }) : null,
          testResult ? /* @__PURE__ */ jsx9(Box8, { marginY: 1, children: /* @__PURE__ */ jsxs8(Text8, { color: testResult.ok ? theme.success : theme.danger, children: [
            testResult.ok ? glyph.check : glyph.cross,
            " ",
            testResult.message
          ] }) }) : null
        ] }),
        /* @__PURE__ */ jsx9(Box8, { justifyContent: "flex-end", flexShrink: 0, marginTop: 1, children: /* @__PURE__ */ jsxs8(Text8, { color: theme.faint, children: [
          /* @__PURE__ */ jsx9(Text8, { color: theme.info, children: "[ Ctrl+T Test Connection ]" }),
          "   ",
          /* @__PURE__ */ jsx9(Text8, { color: theme.accent, children: "[ Ctrl+S Save ]" }),
          "   ",
          /* @__PURE__ */ jsx9(Text8, { color: theme.muted, children: "[ Esc Back ]" })
        ] }) })
      ]
    }
  );
}
var PROVIDER_CHOICES;
var init_connect_dialog = __esm({
  "src/tui/dialogs/connect-dialog.tsx"() {
    "use strict";
    init_definitions();
    init_catalog();
    init_service();
    init_credentials();
    init_redact();
    init_masking();
    init_selector();
    init_components();
    init_theme();
    init_modal();
    PROVIDER_CHOICES = [
      {
        kind: "gemini",
        label: "Google AI Studio",
        detail: "Gemini models through Google AI Studio",
        defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        defaultModel: "gemini-2.5-flash",
        requiresKey: true,
        apiStyle: "gemini"
      },
      {
        kind: "groq",
        label: "Groq Cloud",
        detail: "Fast OpenAI-compatible inference from GroqCloud",
        defaultBaseUrl: "https://api.groq.com/openai/v1",
        defaultModel: "llama-3.3-70b-versatile",
        requiresKey: true,
        apiStyle: "openai-compatible"
      },
      {
        kind: "openrouter",
        label: "OpenRouter",
        detail: "A unified gateway for models with provider-specific pricing",
        defaultBaseUrl: "https://openrouter.ai/api/v1",
        defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
        requiresKey: true,
        apiStyle: "openai-compatible"
      },
      {
        kind: "openai",
        label: "OpenAI-compatible API",
        detail: "Standard /v1/chat/completions endpoint (OpenAI, Anyscale, etc.)",
        defaultBaseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-4o",
        requiresKey: true,
        apiStyle: "openai-compatible"
      },
      {
        kind: "custom",
        label: "Custom Provider (Local / Self-hosted)",
        detail: "Ollama, vLLM, LM Studio, LocalAI, or private inference server",
        defaultBaseUrl: "http://localhost:11434/v1",
        defaultModel: "qwen2.5-coder:32b",
        requiresKey: false,
        apiStyle: "openai-compatible"
      }
    ];
  }
});

// src/tui/dialogs/tasks-dialog.tsx
import { useMemo as useMemo7, useState as useState7 } from "react";
import { Box as Box9, Text as Text9, useInput as useInput7 } from "ink";
import { jsx as jsx10, jsxs as jsxs9 } from "react/jsx-runtime";
function statusColor(status) {
  if (status === "completed") return theme.success;
  if (status === "running") return theme.accent;
  if (status === "paused") return theme.warning;
  if (status === "failed") return theme.danger;
  return theme.faint;
}
function taskTitle2(task) {
  const title = task.metadata.title;
  return typeof title === "string" && title.trim() ? title : task.userRequest;
}
function TasksDialog({
  context,
  onClose,
  onOpenTask,
  onNewTask,
  notify,
  refreshData
}) {
  const [query, setQuery] = useState7("");
  const [selected, setSelected] = useState7(0);
  const [renamingId, setRenamingId] = useState7(null);
  const [renameValue, setRenameValue] = useState7("");
  const [confirmDelete, setConfirmDelete] = useState7(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState7(false);
  const [version, setVersion] = useState7(0);
  const tasks = useMemo7(
    () => context.store.listTasks({ projectPath: context.cwd, limit: 100 }),
    [context, version]
  );
  const filteredTasks = useMemo7(() => {
    return filterByQuery(tasks, query, (task) => [
      task.id,
      task.userRequest,
      taskTitle2(task),
      task.status,
      task.currentModelId ?? "",
      task.projectName
    ]);
  }, [tasks, query]);
  const items = useMemo7(
    () => filteredTasks.map((task) => {
      const changes = task.changedFiles.length;
      const changeLabel = changes > 0 ? `${changes} file${changes > 1 ? "s" : ""}` : "no edits";
      const dateStr = formatRelative(task.updatedAt);
      return {
        key: task.id,
        label: `${task.id.slice(0, 8)}: ${taskTitle2(task).slice(0, 60)}`,
        detail: `${task.projectName} \xB7 ${task.currentModelId ?? "no model"} \xB7 ${changeLabel} \xB7 ${dateStr}`,
        badge: task.status,
        badgeColor: statusColor(task.status)
      };
    }),
    [filteredTasks]
  );
  const handleSelect = (item) => {
    const task = filteredTasks.find((t) => t.id === item.key);
    if (!task) return;
    const shouldResume = task.status === "paused" || task.status === "failed";
    onOpenTask(task.id, shouldResume);
    onClose();
  };
  const handleDelete = (task) => {
    try {
      context.store.deleteTask(task.id);
      notify(`Deleted task ${task.id.slice(0, 8)}.`);
      setConfirmDelete(null);
      setVersion((value) => value + 1);
      refreshData();
    } catch (err) {
      notify(`Failed to delete task: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const handleDeleteAll = () => {
    try {
      let deleted = 0;
      let skipped = 0;
      for (const task of tasks) {
        if (task.status === "running") {
          skipped += 1;
          continue;
        }
        context.store.deleteTask(task.id);
        deleted += 1;
      }
      notify(
        skipped > 0 ? `Deleted ${deleted} task(s); skipped ${skipped} still running.` : `Deleted ${deleted} task(s) and their history.`
      );
      setConfirmDeleteAll(false);
      setVersion((value) => value + 1);
      refreshData();
    } catch (err) {
      notify(`Failed to delete tasks: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const saveRename = () => {
    if (!renamingId) return;
    const title = renameValue.trim();
    if (!title) {
      notify("Task title cannot be empty.");
      return;
    }
    try {
      const task = context.store.getTask(renamingId);
      if (!task) throw new Error("Task no longer exists.");
      context.store.updateTask(task.id, {
        metadata: { ...task.metadata, title }
      });
      notify(`Renamed task to "${title}".`);
      setRenamingId(null);
      setVersion((value) => value + 1);
      refreshData();
    } catch (err) {
      notify(`Failed to rename task: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  useInput7((input, key) => {
    if (renamingId) {
      if (key.escape) {
        setRenamingId(null);
        return;
      }
      if (key.ctrl && input.toLowerCase() === "s") {
        saveRename();
      }
      return;
    }
    if (confirmDelete) {
      if (key.escape || input.toLowerCase() === "n") {
        setConfirmDelete(null);
      } else if (input.toLowerCase() === "y" || key.return) {
        handleDelete(confirmDelete);
      }
      return;
    }
    if (confirmDeleteAll) {
      if (key.escape || input.toLowerCase() === "n") {
        setConfirmDeleteAll(false);
      } else if (input.toLowerCase() === "y" || key.return) {
        handleDeleteAll();
      }
      return;
    }
  });
  if (renamingId) {
    return /* @__PURE__ */ jsx10(
      ModalWindow,
      {
        title: "RENAME TASK",
        subtitle: "Give this saved task a display name",
        width: 64,
        height: 12,
        footer: ["enter or ctrl+s save", "esc cancel"],
        children: /* @__PURE__ */ jsx10(Box9, { marginTop: 1, children: /* @__PURE__ */ jsx10(
          PromptInput,
          {
            value: renameValue,
            onChange: setRenameValue,
            onSubmit: saveRename,
            focus: true,
            placeholder: "Task title"
          }
        ) })
      }
    );
  }
  if (confirmDelete) {
    return /* @__PURE__ */ jsx10(
      ModalWindow,
      {
        title: "DELETE SAVED TASK?",
        subtitle: "This permanently removes its conversation and checkpoints",
        width: 64,
        height: 12,
        borderColor: theme.warning,
        footer: ["y confirm", "n or esc cancel"],
        children: /* @__PURE__ */ jsx10(Box9, { marginTop: 1, children: /* @__PURE__ */ jsx10(Text9, { color: theme.text, wrap: "wrap", children: taskTitle2(confirmDelete) }) })
      }
    );
  }
  if (confirmDeleteAll) {
    return /* @__PURE__ */ jsx10(
      ModalWindow,
      {
        title: "DELETE ALL TASK HISTORY?",
        subtitle: "Removes every saved task, message, and checkpoint in this project",
        width: 64,
        height: 12,
        borderColor: theme.danger,
        footer: ["y confirm", "n or esc cancel"],
        children: /* @__PURE__ */ jsx10(Box9, { marginTop: 1, children: /* @__PURE__ */ jsxs9(Text9, { color: theme.text, wrap: "wrap", children: [
          tasks.filter((t) => t.status !== "running").length,
          " task(s) will be permanently deleted. Running tasks are skipped. Provider profiles and settings are kept."
        ] }) })
      }
    );
  }
  return /* @__PURE__ */ jsx10(
    Selector,
    {
      title: "TASKS & SESSIONS",
      subtitle: `${filteredTasks.length} task${filteredTasks.length !== 1 ? "s" : ""} in this project`,
      items,
      query,
      onQueryChange: setQuery,
      selected,
      onSelectedChange: setSelected,
      onSelect: handleSelect,
      onClose,
      searchPlaceholder: "Filter tasks by prompt, id, model, or status\u2026",
      emptyText: "No matching tasks found.",
      footer: [
        "\u2191\u2193 navigate",
        "enter open/continue",
        "ctrl+n new task",
        "ctrl+r rename",
        "ctrl+d delete this task",
        "ctrl+x clear all tasks",
        "esc close"
      ],
      onKey: (input, key, currentItem) => {
        if (key.ctrl && input === "n") {
          onNewTask();
          onClose();
          return true;
        }
        if (key.ctrl && input === "d") {
          if (currentItem) {
            const task = filteredTasks.find((t) => t.id === currentItem.key);
            if (task) setConfirmDelete(task);
          }
          return true;
        }
        if (key.ctrl && input === "r") {
          if (currentItem) {
            const task = filteredTasks.find((t) => t.id === currentItem.key);
            if (task) {
              setRenamingId(task.id);
              setRenameValue(taskTitle2(task));
            }
          }
          return true;
        }
        if (key.ctrl && input === "x") {
          if (tasks.length > 0) setConfirmDeleteAll(true);
          return true;
        }
        return false;
      }
    }
  );
}
var init_tasks_dialog = __esm({
  "src/tui/dialogs/tasks-dialog.tsx"() {
    "use strict";
    init_selector();
    init_components();
    init_modal();
    init_theme();
    init_output();
  }
});

// src/tui/dialogs/diff-dialog.tsx
import { useEffect as useEffect7, useState as useState8 } from "react";
import { Box as Box10, Text as Text10, useInput as useInput8 } from "ink";
import { jsx as jsx11 } from "react/jsx-runtime";
function DiffDialog({ context, taskId, onClose }) {
  const [loading, setLoading] = useState8(true);
  const [summary, setSummary] = useState8(null);
  const [diffText, setDiffText] = useState8("");
  const [scrollOffset, setScrollOffset] = useState8(0);
  useEffect7(() => {
    let active = true;
    async function loadDiff() {
      setLoading(true);
      try {
        const sum = await gitSummary(context.cwd);
        if (!active) return;
        setSummary(sum);
        const task = taskId ? context.store.getTask(taskId) : null;
        const targetFiles = task && task.changedFiles.length > 0 ? task.changedFiles : sum.files.map((f) => f.path);
        if (targetFiles.length > 0) {
          const diffRes = await gitDiffForFiles(context.cwd, targetFiles);
          if (active) setDiffText(diffRes || "No differences detected in changed files.");
        } else {
          if (active) setDiffText("No files have been modified yet.");
        }
      } catch (err) {
        if (active) setDiffText(`Failed to load diff: ${String(err)}`);
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadDiff();
    return () => {
      active = false;
    };
  }, [context, taskId]);
  const diffLines = diffText.split(/\r?\n/);
  const visibleLineCount = 10;
  const maxScroll = Math.max(0, diffLines.length - visibleLineCount);
  const visibleLines = diffLines.slice(scrollOffset, scrollOffset + visibleLineCount);
  useInput8((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setScrollOffset((v) => Math.max(0, v - 1));
      return;
    }
    if (key.downArrow) {
      setScrollOffset((v) => Math.min(maxScroll, v + 1));
      return;
    }
    if (key.pageUp) {
      setScrollOffset((v) => Math.max(0, v - 10));
      return;
    }
    if (key.pageDown) {
      setScrollOffset((v) => Math.min(maxScroll, v + 10));
      return;
    }
  });
  return /* @__PURE__ */ jsx11(
    ModalWindow,
    {
      title: `GIT DIFF ${taskId ? `(Task ${taskId.slice(0, 8)})` : ""}`,
      subtitle: summary?.branch ? `\u2387 ${summary.branch} \xB7 ${diffLines.length} lines` : `${diffLines.length} lines`,
      width: 74,
      height: 18,
      footer: [
        summary?.clean ? "tree clean" : `${summary?.files.length ?? 0} modified`,
        "\u2191/\u2193 scroll",
        "esc close"
      ],
      children: loading ? /* @__PURE__ */ jsx11(Box10, { marginY: 2, children: /* @__PURE__ */ jsx11(Spinner, { frame: 0, label: "Reading git diff\u2026" }) }) : /* @__PURE__ */ jsx11(Box10, { flexDirection: "column", flexGrow: 1, overflow: "hidden", children: visibleLines.map((line, idx) => {
        let color = theme.text;
        if (line.startsWith("+") && !line.startsWith("+++")) color = theme.success;
        else if (line.startsWith("-") && !line.startsWith("---")) color = theme.danger;
        else if (line.startsWith("@@")) color = theme.info;
        else if (line.startsWith("diff ") || line.startsWith("index ")) color = theme.faint;
        return /* @__PURE__ */ jsx11(Text10, { color, wrap: "truncate", children: line || " " }, `${scrollOffset + idx}`);
      }) })
    }
  );
}
var init_diff_dialog = __esm({
  "src/tui/dialogs/diff-dialog.tsx"() {
    "use strict";
    init_repository();
    init_components();
    init_theme();
    init_modal();
  }
});

// src/tui/dialogs/undo-dialog.tsx
import { useEffect as useEffect8, useState as useState9 } from "react";
import { Box as Box11, Text as Text11, useInput as useInput9 } from "ink";
import { jsx as jsx12, jsxs as jsxs10 } from "react/jsx-runtime";
function UndoDialog({
  context,
  taskId,
  onClose,
  notify,
  refreshData
}) {
  const [loading, setLoading] = useState9(true);
  const [plan, setPlan] = useState9(null);
  const [statusMessage, setStatusMessage] = useState9(null);
  const [done, setDone] = useState9(false);
  const task = taskId ? context.store.getTask(taskId) : null;
  useEffect8(() => {
    let active = true;
    async function computePlan() {
      if (!task) {
        setLoading(false);
        return;
      }
      try {
        const undoPlan = await planUndo(context.cwd, task);
        if (active) setPlan(undoPlan);
      } catch (err) {
        if (active) {
          setPlan({
            supported: false,
            reason: String(err),
            items: [],
            skipped: [],
            restoreCount: 0,
            deleteCount: 0
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void computePlan();
    return () => {
      active = false;
    };
  }, [context, task]);
  const executeUndo = async () => {
    if (!plan || !plan.supported || plan.items.length === 0) return;
    setStatusMessage("Restoring files from baseline snapshot\u2026");
    try {
      const res = await performUndo(context.cwd, plan);
      if (res.ok) {
        notify(
          `Safely reverted ${res.restored.length} file(s) and deleted ${res.deleted.length} created file(s).`
        );
        refreshData();
        setDone(true);
        setTimeout(onClose, 800);
      } else {
        notify(`Undo completed with errors: ${res.failed.map((f) => f.message).join(", ")}`);
        onClose();
      }
    } catch (err) {
      notify(`Undo failed: ${String(err)}`);
      onClose();
    }
  };
  useInput9((input, key) => {
    if (key.escape || input.toLowerCase() === "n") {
      onClose();
      return;
    }
    if (input.toLowerCase() === "y" || key.return) {
      if (plan && plan.supported && plan.items.length > 0 && !done && !statusMessage) {
        void executeUndo();
      }
    }
  });
  if (!task) {
    return /* @__PURE__ */ jsxs10(
      ModalWindow,
      {
        title: "SAFE UNDO",
        width: 68,
        height: 10,
        borderColor: theme.warning,
        footer: ["esc close"],
        children: [
          /* @__PURE__ */ jsx12(Text11, { bold: true, color: theme.warning, children: "No active task" }),
          /* @__PURE__ */ jsx12(Text11, { color: theme.muted, children: "Undo requires an active task that modified files. Start or resume a task first." })
        ]
      }
    );
  }
  return /* @__PURE__ */ jsx12(
    ModalWindow,
    {
      title: `SAFE UNDO \u2014 TASK ${task.id.slice(0, 8)}`,
      width: 72,
      height: 18,
      borderColor: theme.warning,
      footer: ["y confirm revert", "n / esc cancel"],
      children: loading ? /* @__PURE__ */ jsx12(Box11, { marginY: 2, children: /* @__PURE__ */ jsx12(Spinner, { frame: 0, label: "Analyzing task baseline snapshot and safety checks\u2026" }) }) : statusMessage ? /* @__PURE__ */ jsx12(Box11, { marginY: 2, children: /* @__PURE__ */ jsx12(Spinner, { frame: 0, label: statusMessage }) }) : /* @__PURE__ */ jsx12(Box11, { flexDirection: "column", flexGrow: 1, overflow: "hidden", children: !plan?.supported ? /* @__PURE__ */ jsxs10(Box11, { flexDirection: "column", children: [
        /* @__PURE__ */ jsx12(Text11, { color: theme.danger, bold: true, children: "Undo not possible for this task" }),
        /* @__PURE__ */ jsx12(Text11, { color: theme.muted, children: plan?.reason ?? "No baseline snapshot was recorded for this task or git is unavailable." })
      ] }) : plan.items.length === 0 ? /* @__PURE__ */ jsxs10(Box11, { flexDirection: "column", children: [
        /* @__PURE__ */ jsx12(Text11, { color: theme.success, children: "No modified files to revert." }),
        /* @__PURE__ */ jsx12(Text11, { color: theme.muted, children: "The task did not alter any files or files are already in their pre-task state." })
      ] }) : /* @__PURE__ */ jsxs10(Box11, { flexDirection: "column", children: [
        /* @__PURE__ */ jsx12(Text11, { color: theme.text, bold: true, children: "The following actions will be performed safely:" }),
        /* @__PURE__ */ jsx12(Box11, { flexDirection: "column", marginY: 1, children: plan.items.map((item) => /* @__PURE__ */ jsxs10(Box11, { children: [
          /* @__PURE__ */ jsxs10(Text11, { color: item.action === "restore" ? theme.warning : theme.danger, children: [
            item.action === "restore" ? "\u21BA restore" : "\u2715 delete",
            ":",
            " "
          ] }),
          /* @__PURE__ */ jsx12(Text11, { color: theme.text, children: item.path }),
          /* @__PURE__ */ jsxs10(Text11, { color: theme.faint, children: [
            " (",
            item.reason,
            ")"
          ] })
        ] }, item.path)) }),
        plan.skipped.length > 0 ? /* @__PURE__ */ jsxs10(Box11, { flexDirection: "column", marginTop: 1, children: [
          /* @__PURE__ */ jsxs10(Text11, { color: theme.info, children: [
            "Notice: ",
            plan.skipped.length,
            " file(s) will be protected and preserved:"
          ] }),
          plan.skipped.map((skip) => /* @__PURE__ */ jsxs10(Text11, { color: theme.faint, children: [
            "\xB7 ",
            skip.path,
            ": ",
            skip.reason
          ] }, skip.path))
        ] }) : null,
        /* @__PURE__ */ jsx12(Box11, { marginTop: 1, children: /* @__PURE__ */ jsx12(Text11, { color: theme.warm, bold: true, children: "Are you sure you want to revert these files? (y / n)" }) })
      ] }) })
    }
  );
}
var init_undo_dialog = __esm({
  "src/tui/dialogs/undo-dialog.tsx"() {
    "use strict";
    init_repository();
    init_components();
    init_theme();
    init_modal();
  }
});

// src/tui/dialogs/status-dialog.tsx
import { useEffect as useEffect9, useState as useState10 } from "react";
import { Box as Box12, Text as Text12, useInput as useInput10 } from "ink";
import { jsx as jsx13, jsxs as jsxs11 } from "react/jsx-runtime";
function lastCheckSucceeded2(profile) {
  return Boolean(
    profile.lastSuccessAt && (!profile.lastErrorAt || profile.lastSuccessAt >= profile.lastErrorAt)
  );
}
function lastCheckFailed(profile) {
  return Boolean(
    profile.lastError && (!profile.lastSuccessAt || !profile.lastErrorAt || profile.lastErrorAt > profile.lastSuccessAt)
  );
}
function StatusDialog({ context, taskId, onClose }) {
  const [git, setGit] = useState10(null);
  const profiles = context.store.listProfiles();
  const activeProfileId = context.store.getSelectedProfileId();
  const activeModelId = context.store.getSelectedModelId();
  const settings = context.store.getSettings();
  const limits2 = context.store.listLimits(true);
  const task = taskId ? context.store.getTask(taskId) : null;
  useEffect9(() => {
    let active = true;
    void gitSummary(context.cwd).then((sum) => {
      if (active) setGit(sum);
    });
    return () => {
      active = false;
    };
  }, [context]);
  useInput10((_input, key) => {
    if (key.escape) onClose();
  });
  return /* @__PURE__ */ jsx13(
    ModalWindow,
    {
      title: "SYSTEM & QUOTA STATUS",
      subtitle: `${profiles.length} profile(s)`,
      width: 72,
      height: 18,
      borderColor: theme.info,
      footer: ["esc close"],
      children: /* @__PURE__ */ jsxs11(Box12, { flexDirection: "column", flexGrow: 1, overflow: "hidden", children: [
        /* @__PURE__ */ jsxs11(Box12, { flexDirection: "column", marginBottom: 1, children: [
          /* @__PURE__ */ jsx13(Text12, { color: theme.accent, bold: true, children: "Active Model & Routing" }),
          /* @__PURE__ */ jsxs11(Text12, { color: theme.text, children: [
            "\xB7 Selected Profile:",
            " ",
            /* @__PURE__ */ jsx13(Text12, { color: theme.warm, children: profiles.find((p) => p.id === activeProfileId)?.name ?? "(none selected)" })
          ] }),
          /* @__PURE__ */ jsxs11(Text12, { color: theme.text, children: [
            "\xB7 Selected Model:",
            " ",
            /* @__PURE__ */ jsx13(Text12, { color: theme.warm, children: activeModelId ?? "(provider default)" })
          ] }),
          /* @__PURE__ */ jsxs11(Text12, { color: theme.text, children: [
            "\xB7 Paid Fallbacks:",
            " ",
            /* @__PURE__ */ jsx13(Text12, { color: settings.routing.allowPaid ? theme.warning : theme.success, children: settings.routing.allowPaid ? "Paid fallbacks allowed" : "Paid fallbacks disabled" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs11(Box12, { flexDirection: "column", marginBottom: 1, children: [
          /* @__PURE__ */ jsxs11(Text12, { color: theme.accent, bold: true, children: [
            "Provider Profiles (",
            profiles.length,
            ")"
          ] }),
          profiles.length === 0 ? /* @__PURE__ */ jsx13(Text12, { color: theme.faint, children: "No provider profiles configured yet." }) : profiles.map((p) => {
            const profileLimits = limits2.filter((l) => l.profileId === p.id);
            const isLimited = profileLimits.length > 0;
            const status = !p.enabled ? "Disabled" : isLimited ? `Rate limited (${profileLimits.map((l) => l.category).join(", ")})` : lastCheckFailed(p) ? "Last check failed" : lastCheckSucceeded2(p) ? "Last check passed" : "Not verified";
            return /* @__PURE__ */ jsxs11(Box12, { justifyContent: "space-between", children: [
              /* @__PURE__ */ jsxs11(Text12, { color: theme.text, children: [
                lastCheckSucceeded2(p) ? glyph.check : glyph.ring,
                " ",
                p.name,
                " ",
                /* @__PURE__ */ jsxs11(Text12, { color: theme.faint, children: [
                  "(",
                  providerDisplayName(p.providerId),
                  ")"
                ] })
              ] }),
              /* @__PURE__ */ jsx13(
                Text12,
                {
                  color: isLimited || lastCheckFailed(p) ? theme.danger : lastCheckSucceeded2(p) ? theme.success : theme.faint,
                  children: status
                }
              )
            ] }, p.id);
          })
        ] }),
        /* @__PURE__ */ jsxs11(Box12, { flexDirection: "column", marginBottom: 1, children: [
          /* @__PURE__ */ jsx13(Text12, { color: theme.accent, bold: true, children: "Git Repository" }),
          /* @__PURE__ */ jsxs11(Text12, { color: theme.text, children: [
            "\xB7 Branch: ",
            /* @__PURE__ */ jsx13(Text12, { color: theme.violet, children: git?.branch ?? "(not a git repo)" })
          ] }),
          /* @__PURE__ */ jsxs11(Text12, { color: theme.text, children: [
            "\xB7 Status:",
            " ",
            /* @__PURE__ */ jsx13(Text12, { color: git?.clean ? theme.success : theme.warning, children: git?.clean ? "Clean working directory" : `${git?.files.length ?? 0} modified file(s)` })
          ] })
        ] }),
        task ? /* @__PURE__ */ jsxs11(Box12, { flexDirection: "column", children: [
          /* @__PURE__ */ jsxs11(Text12, { color: theme.accent, bold: true, children: [
            "Active Task (",
            task.id.slice(0, 8),
            ")"
          ] }),
          /* @__PURE__ */ jsxs11(Text12, { color: theme.text, children: [
            "\xB7 Status: ",
            /* @__PURE__ */ jsx13(Text12, { color: theme.warm, children: task.status }),
            " (Phase: ",
            task.phase,
            ")"
          ] }),
          /* @__PURE__ */ jsxs11(Text12, { color: theme.text, children: [
            "\xB7 Request: ",
            /* @__PURE__ */ jsx13(Text12, { color: theme.faint, children: task.userRequest.slice(0, 60) })
          ] }),
          /* @__PURE__ */ jsxs11(Text12, { color: theme.text, children: [
            "\xB7 Changed files: ",
            task.changedFiles.length,
            " file(s)"
          ] })
        ] }) : null
      ] })
    }
  );
}
var init_status_dialog = __esm({
  "src/tui/dialogs/status-dialog.tsx"() {
    "use strict";
    init_repository();
    init_theme();
    init_definitions();
    init_modal();
  }
});

// src/tui/dialogs/usage-dialog.tsx
import { useMemo as useMemo8, useState as useState11 } from "react";
import { Box as Box13, Text as Text13, useInput as useInput11 } from "ink";
import { jsx as jsx14, jsxs as jsxs12 } from "react/jsx-runtime";
function money2(value) {
  if (value === null) return "\u2014";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(5)}`;
  return `$${value.toFixed(3)}`;
}
function UsageDialog({
  context,
  onClose,
  notify,
  refreshData
}) {
  const [todayOnly, setTodayOnly] = useState11(false);
  const since = useMemo8(() => {
    if (!todayOnly) return void 0;
    const now = /* @__PURE__ */ new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }, [todayOnly]);
  const totals = context.store.usageTotals(since);
  const byModel = context.store.usageByModel(since).slice(0, 5);
  const limits2 = context.store.listLimits(true);
  useInput11((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (input === "t" || input === "T") {
      setTodayOnly((v) => !v);
      return;
    }
    if (input === "c" || input === "C") {
      if (limits2.length === 0) return;
      for (const limit of limits2) {
        context.store.clearLimit(limit.profileId, limit.modelId);
      }
      notify(`Cleared ${limits2.length} active limit(s).`);
      refreshData();
      return;
    }
  });
  return /* @__PURE__ */ jsx14(
    ModalWindow,
    {
      title: "TOKEN USAGE & PROVIDER LIMITS",
      subtitle: todayOnly ? "today only" : "all-time",
      width: 72,
      height: 19,
      borderColor: theme.accent,
      footer: [
        "t toggle all/today",
        limits2.length > 0 ? "c clear active limits" : "limits active: " + limits2.length,
        "esc close"
      ],
      children: /* @__PURE__ */ jsxs12(Box13, { flexDirection: "column", flexGrow: 1, overflow: "hidden", children: [
        /* @__PURE__ */ jsxs12(
          Box13,
          {
            justifyContent: "space-between",
            paddingX: 1,
            marginBottom: 1,
            borderStyle: "single",
            borderColor: theme.border,
            children: [
              /* @__PURE__ */ jsxs12(Box13, { flexDirection: "column", children: [
                /* @__PURE__ */ jsx14(Text13, { color: theme.faint, children: "INPUT TOKENS" }),
                /* @__PURE__ */ jsx14(Text13, { bold: true, color: theme.text, children: formatCount(totals.inputTokens) })
              ] }),
              /* @__PURE__ */ jsxs12(Box13, { flexDirection: "column", children: [
                /* @__PURE__ */ jsx14(Text13, { color: theme.faint, children: "OUTPUT TOKENS" }),
                /* @__PURE__ */ jsx14(Text13, { bold: true, color: theme.text, children: formatCount(totals.outputTokens) })
              ] }),
              /* @__PURE__ */ jsxs12(Box13, { flexDirection: "column", children: [
                /* @__PURE__ */ jsx14(Text13, { color: theme.faint, children: "TOTAL TOKENS" }),
                /* @__PURE__ */ jsx14(Text13, { bold: true, color: theme.accent, children: formatCount(totals.inputTokens + totals.outputTokens) })
              ] }),
              /* @__PURE__ */ jsxs12(Box13, { flexDirection: "column", children: [
                /* @__PURE__ */ jsx14(Text13, { color: theme.faint, children: "EVENTS" }),
                /* @__PURE__ */ jsx14(Text13, { bold: true, color: theme.text, children: formatCount(totals.events) })
              ] }),
              /* @__PURE__ */ jsxs12(Box13, { flexDirection: "column", children: [
                /* @__PURE__ */ jsx14(Text13, { color: theme.faint, children: "ESTIMATED COST" }),
                /* @__PURE__ */ jsx14(Text13, { bold: true, color: theme.success, children: money2(totals.cost) })
              ] })
            ]
          }
        ),
        /* @__PURE__ */ jsxs12(Box13, { flexDirection: "column", marginBottom: 1, children: [
          /* @__PURE__ */ jsxs12(Text13, { color: theme.accent, bold: true, children: [
            "Active Provider Rate Limits (",
            limits2.length,
            ")"
          ] }),
          limits2.length === 0 ? /* @__PURE__ */ jsx14(Text13, { color: theme.muted, children: "No active rate limits recorded. All providers available." }) : limits2.slice(0, 3).map((limit) => {
            const profile = context.store.getProfile(limit.profileId);
            return /* @__PURE__ */ jsxs12(Box13, { justifyContent: "space-between", children: [
              /* @__PURE__ */ jsxs12(Text13, { color: theme.warning, children: [
                "\xB7 ",
                profile?.name ?? limit.profileId,
                " (",
                limit.modelId ?? "all models",
                ")"
              ] }),
              /* @__PURE__ */ jsxs12(Text13, { color: theme.faint, children: [
                describeCategory(limit.category),
                " \xB7 resets",
                " ",
                limit.resetAt ? formatDateTime(limit.resetAt) : "unknown"
              ] })
            ] }, `${limit.profileId}-${limit.modelId}`);
          })
        ] }),
        /* @__PURE__ */ jsxs12(Box13, { flexDirection: "column", children: [
          /* @__PURE__ */ jsx14(Text13, { color: theme.accent, bold: true, children: "Top Models by Usage" }),
          byModel.length === 0 ? /* @__PURE__ */ jsx14(Text13, { color: theme.muted, children: "No recorded usage for this period." }) : byModel.map((item) => /* @__PURE__ */ jsxs12(Box13, { justifyContent: "space-between", children: [
            /* @__PURE__ */ jsxs12(Text13, { color: theme.text, wrap: "truncate", children: [
              "\xB7 ",
              item.modelId
            ] }),
            /* @__PURE__ */ jsxs12(Text13, { color: theme.faint, children: [
              formatCount(item.inputTokens + item.outputTokens),
              " tokens \xB7",
              " ",
              money2(item.costEstimate)
            ] })
          ] }, item.modelId))
        ] })
      ] })
    }
  );
}
var init_usage_dialog = __esm({
  "src/tui/dialogs/usage-dialog.tsx"() {
    "use strict";
    init_components();
    init_output();
    init_errors();
    init_theme();
    init_modal();
  }
});

// src/tui/dialogs/settings-dialog.tsx
import { useState as useState12 } from "react";
import { Box as Box14, Text as Text14, useInput as useInput12 } from "ink";
import { jsx as jsx15, jsxs as jsxs13 } from "react/jsx-runtime";
function toggleLabel(value, onText, offText) {
  return value ? `ON (${onText})` : `OFF (${offText})`;
}
function SettingsDialog({
  context,
  onClose,
  notify,
  refreshData
}) {
  const [selectedIndex, setSelectedIndex] = useState12(0);
  const settings = context.store.getSettings();
  const update = (mutate) => {
    context.store.updateSettings((s) => {
      mutate(s);
      return s;
    });
    refreshData();
  };
  const cycleTheme = (direction) => {
    const index = Math.max(0, THEME_NAMES.indexOf(settings.ui.theme));
    const next = THEME_NAMES[(index + direction + THEME_NAMES.length) % THEME_NAMES.length];
    update((s) => {
      s.ui.theme = next;
    });
    notify(`Theme set to ${THEME_LABELS[next] ?? next}.`);
  };
  const cycleAccent = (direction) => {
    const index = ACCENTS.indexOf(settings.accent);
    const next = ACCENTS[(index + direction + ACCENTS.length) % ACCENTS.length];
    update((s) => {
      s.accent = next;
    });
    notify(`Accent color set to ${next}.`);
  };
  const stepNumber = (current, min, max, step, apply) => {
    apply(Math.min(max, Math.max(min, current + step)));
    refreshData();
  };
  const items = [
    {
      id: "allowPaid",
      label: "Paid model fallbacks",
      description: "Allow routing to fall back to paid models when free models are exhausted",
      value: toggleLabel(settings.routing.allowPaid, "Allowed", "Free-only"),
      type: "toggle",
      onNext: () => update((s) => {
        s.routing.allowPaid = !s.routing.allowPaid;
      }),
      onPrev: () => update((s) => {
        s.routing.allowPaid = !s.routing.allowPaid;
      })
    },
    {
      id: "preferFree",
      label: "Prefer free models",
      description: "Bias routing toward models classified as free or free-tier",
      value: toggleLabel(settings.routing.preferFree, "Preferred", "Off"),
      type: "toggle",
      onNext: () => update((s) => {
        s.routing.preferFree = !s.routing.preferFree;
      }),
      onPrev: () => update((s) => {
        s.routing.preferFree = !s.routing.preferFree;
      })
    },
    {
      id: "allowUnknownAccess",
      label: "Allow unknown-access models",
      description: "Allow fallback to models whose pricing/access could not be determined",
      value: toggleLabel(settings.routing.allowUnknownAccess, "Allowed", "Blocked"),
      type: "toggle",
      onNext: () => update((s) => {
        s.routing.allowUnknownAccess = !s.routing.allowUnknownAccess;
      }),
      onPrev: () => update((s) => {
        s.routing.allowUnknownAccess = !s.routing.allowUnknownAccess;
      })
    },
    {
      id: "maxFallbacks",
      label: "Maximum fallback candidates",
      description: "How many alternative profiles/models routing may try per pass",
      value: `${settings.routing.maxFallbacks} candidates`,
      type: "number",
      onNext: () => stepNumber(settings.routing.maxFallbacks, 1, 20, 1, (value) => {
        update((s) => {
          s.routing.maxFallbacks = value;
        });
      }),
      onPrev: () => stepNumber(settings.routing.maxFallbacks, 1, 20, -1, (value) => {
        update((s) => {
          s.routing.maxFallbacks = value;
        });
      })
    },
    {
      id: "maxRetriesPerCandidate",
      label: "Retries per candidate",
      description: "Retry attempts against a single model before moving to the next fallback",
      value: `${settings.routing.maxRetriesPerCandidate} retries`,
      type: "number",
      onNext: () => stepNumber(settings.routing.maxRetriesPerCandidate, 0, 5, 1, (value) => {
        update((s) => {
          s.routing.maxRetriesPerCandidate = value;
        });
      }),
      onPrev: () => stepNumber(settings.routing.maxRetriesPerCandidate, 0, 5, -1, (value) => {
        update((s) => {
          s.routing.maxRetriesPerCandidate = value;
        });
      })
    },
    {
      id: "maxSteps",
      label: "Max agent steps per run",
      description: "Upper bound on iterations per coding task turn",
      value: `${settings.agent.maxSteps} steps`,
      type: "number",
      onNext: () => stepNumber(settings.agent.maxSteps, 1, 200, 10, (value) => {
        update((s) => {
          s.agent.maxSteps = value;
        });
      }),
      onPrev: () => stepNumber(settings.agent.maxSteps, 1, 200, -10, (value) => {
        update((s) => {
          s.agent.maxSteps = value;
        });
      })
    },
    {
      id: "autoApproveReadOnly",
      label: "Auto-approve read-only tools",
      description: "Run inspection commands (ls, grep, git status) without asking",
      value: toggleLabel(settings.agent.autoApproveReadOnly, "Auto", "Ask"),
      type: "toggle",
      onNext: () => update((s) => {
        s.agent.autoApproveReadOnly = !s.agent.autoApproveReadOnly;
      }),
      onPrev: () => update((s) => {
        s.agent.autoApproveReadOnly = !s.agent.autoApproveReadOnly;
      })
    },
    {
      id: "autoApproveFileEdits",
      label: "Auto-approve file edits",
      description: "Write and patch files without an approval prompt",
      value: toggleLabel(settings.agent.autoApproveFileEdits, "Auto", "Ask"),
      type: "toggle",
      onNext: () => update((s) => {
        s.agent.autoApproveFileEdits = !s.agent.autoApproveFileEdits;
      }),
      onPrev: () => update((s) => {
        s.agent.autoApproveFileEdits = !s.agent.autoApproveFileEdits;
      })
    },
    {
      id: "autoApproveCommands",
      label: "Auto-approve shell commands",
      description: "Run non-read-only commands without an approval prompt",
      value: toggleLabel(settings.agent.autoApproveCommands, "Auto", "Ask"),
      type: "toggle",
      onNext: () => update((s) => {
        s.agent.autoApproveCommands = !s.agent.autoApproveCommands;
      }),
      onPrev: () => update((s) => {
        s.agent.autoApproveCommands = !s.agent.autoApproveCommands;
      })
    },
    {
      id: "permissionMode",
      label: "Permission mode",
      description: "ask = prompt each time \xB7 trusted = auto-approve edits and normal commands \xB7 auto = never prompt",
      value: PERMISSION_LABELS[settings.agent.permissionMode] ?? settings.agent.permissionMode,
      type: "cycle",
      onNext: () => update((s) => {
        const index = PERMISSION_MODES.indexOf(s.agent.permissionMode);
        s.agent.permissionMode = PERMISSION_MODES[(index + 1) % PERMISSION_MODES.length];
      }),
      onPrev: () => update((s) => {
        const index = PERMISSION_MODES.indexOf(s.agent.permissionMode);
        s.agent.permissionMode = PERMISSION_MODES[(index - 1 + PERMISSION_MODES.length) % PERMISSION_MODES.length];
      })
    },
    {
      id: "theme",
      label: "UI theme",
      description: "Color palette \u2014 dark and light themes included",
      value: THEME_LABELS[settings.ui.theme] ?? settings.ui.theme,
      type: "cycle",
      onNext: () => cycleTheme(1),
      onPrev: () => cycleTheme(-1)
    },
    {
      id: "accent",
      label: "Accent color",
      description: "Highlight color for selected items, indicators, and borders",
      value: settings.accent,
      type: "cycle",
      onNext: () => cycleAccent(1),
      onPrev: () => cycleAccent(-1)
    },
    {
      id: "mouseScroll",
      label: "Mouse wheel scroll",
      description: "Scroll the transcript with the mouse wheel. While on, hold Shift+drag or press ctrl+y to highlight and copy text.",
      value: toggleLabel(settings.ui.mouseScroll, "On", "Off"),
      type: "toggle",
      onNext: () => update((s) => {
        s.ui.mouseScroll = !s.ui.mouseScroll;
      }),
      onPrev: () => update((s) => {
        s.ui.mouseScroll = !s.ui.mouseScroll;
      })
    }
  ];
  useInput12((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((cur) => (cur - 1 + items.length) % items.length);
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((cur) => (cur + 1) % items.length);
      return;
    }
    if (key.leftArrow) {
      items[selectedIndex]?.onPrev();
      return;
    }
    if (key.rightArrow || key.return || input === " ") {
      items[selectedIndex]?.onNext();
      return;
    }
  });
  const { rows } = useLayout();
  const ITEM_HEIGHT = 3;
  const modalHeight = Math.min(rows - 4, items.length * ITEM_HEIGHT + 8);
  const visibleCount = Math.max(1, Math.floor((modalHeight - 7) / ITEM_HEIGHT));
  const scrollStart = Math.min(
    Math.max(0, selectedIndex - Math.floor(visibleCount / 2)),
    Math.max(0, items.length - visibleCount)
  );
  const visibleItems = items.slice(scrollStart, scrollStart + visibleCount);
  return /* @__PURE__ */ jsx15(
    ModalWindow,
    {
      title: "COMICODE SETTINGS",
      subtitle: `${items.length} options \xB7 \u2191/\u2193 scroll`,
      width: 72,
      height: modalHeight,
      footer: ["\u2191/\u2193 select setting", "\u2190/\u2192 or enter change", "esc close"],
      children: /* @__PURE__ */ jsxs13(Box14, { flexDirection: "column", flexGrow: 1, overflow: "hidden", children: [
        scrollStart > 0 ? /* @__PURE__ */ jsx15(Text14, { color: theme.faint, children: "  \u22EE" }) : null,
        visibleItems.map((item, offset) => {
          const index = scrollStart + offset;
          const isSelected = index === selectedIndex;
          return /* @__PURE__ */ jsxs13(
            Box14,
            {
              flexDirection: "column",
              marginBottom: 1,
              paddingX: 1,
              borderStyle: isSelected ? "single" : void 0,
              borderColor: isSelected ? theme.accent : void 0,
              children: [
                /* @__PURE__ */ jsxs13(Box14, { justifyContent: "space-between", children: [
                  /* @__PURE__ */ jsxs13(Text14, { bold: isSelected, color: isSelected ? theme.accent : theme.text, children: [
                    isSelected ? `${glyph.active} ` : "  ",
                    item.label
                  ] }),
                  /* @__PURE__ */ jsxs13(
                    Text14,
                    {
                      bold: true,
                      color: item.value.startsWith("ON") || item.value.startsWith("YES") ? theme.success : item.value.startsWith("OFF") || item.value.startsWith("NO") ? theme.warning : theme.accent,
                      children: [
                        item.value,
                        " ",
                        isSelected ? "\u25C0\u25B6" : ""
                      ]
                    }
                  )
                ] }),
                /* @__PURE__ */ jsx15(Box14, { paddingLeft: 2, children: /* @__PURE__ */ jsx15(Text14, { color: theme.faint, wrap: "truncate", children: item.description }) })
              ]
            },
            item.id
          );
        }),
        scrollStart + visibleCount < items.length ? /* @__PURE__ */ jsx15(Text14, { color: theme.faint, children: "  \u22EE" }) : null
      ] })
    }
  );
}
var ACCENTS, PERMISSION_MODES, PERMISSION_LABELS;
var init_settings_dialog = __esm({
  "src/tui/dialogs/settings-dialog.tsx"() {
    "use strict";
    init_theme();
    init_components();
    init_modal();
    ACCENTS = ["cyan", "blue", "green", "magenta", "orange"];
    PERMISSION_MODES = ["ask", "trusted", "auto"];
    PERMISSION_LABELS = {
      ask: "ASK EVERY TIME",
      trusted: "TRUSTED (no prompts for edits/commands)",
      auto: "AUTO (never ask)"
    };
  }
});

// src/tui/shortcuts/manager.ts
function getShortcut(id) {
  return shortcutById.get(id) ?? null;
}
function shortcutsByScope(scope) {
  return SHORTCUTS.filter((shortcut) => shortcut.scope === scope);
}
function parseBinding(binding) {
  const tokens = binding.trim().toLowerCase().split("+").map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  const key = tokens.pop();
  const parsed = { ctrl: false, meta: false, shift: false, key };
  for (const token of tokens) {
    if (token === "ctrl" || token === "control") parsed.ctrl = true;
    else if (token === "meta" || token === "alt" || token === "option") parsed.meta = true;
    else if (token === "shift") parsed.shift = true;
    else return null;
  }
  parsed.key = NAMED_KEYS[key] ?? key;
  return parsed;
}
function eventMatchesBinding(input, key, binding) {
  const ctrl = Boolean(key.ctrl);
  const meta = Boolean(key.meta);
  const shift = Boolean(key.shift);
  if (binding.ctrl !== ctrl || binding.meta !== meta) return false;
  if (binding.shift && !shift) return false;
  switch (binding.key) {
    case "return":
      return Boolean(key.return) || input === "\r" || input === "\n";
    case "escape":
      return Boolean(key.escape);
    case "tab":
      return Boolean(key.tab);
    case "backspace":
      return Boolean(key.backspace);
    case "delete":
      return Boolean(key.delete);
    case "up":
      return Boolean(key.upArrow);
    case "down":
      return Boolean(key.downArrow);
    case "left":
      return Boolean(key.leftArrow);
    case "right":
      return Boolean(key.rightArrow);
    case "pageup":
      return Boolean(key.pageUp);
    case "pagedown":
      return Boolean(key.pageDown);
    default:
      return input.toLowerCase() === binding.key;
  }
}
function bindingsFor(id, overrides = {}) {
  const definition = getShortcut(id);
  if (!definition) return [];
  const configured = overrides[id]?.trim();
  const candidates = configured ? [configured] : definition.keys;
  const parsed = candidates.map(parseBinding).filter((entry) => entry !== null);
  return parsed.length ? parsed : definition.keys.map(parseBinding).filter((entry) => entry !== null);
}
function shortcutMatches(id, input, key, overrides = {}) {
  return bindingsFor(id, overrides).some((binding) => eventMatchesBinding(input, key, binding));
}
function shortcutLines() {
  const lines = [];
  const labels = {
    global: "GLOBAL",
    workspace: "WORKSPACE",
    dialog: "DIALOGS"
  };
  for (const scope of ["global", "workspace", "dialog"]) {
    lines.push(labels[scope]);
    for (const shortcut of shortcutsByScope(scope)) {
      lines.push(`  ${shortcut.keys.join(" / ").padEnd(18)} ${shortcut.description}`);
    }
    lines.push("");
  }
  return lines;
}
var SHORTCUTS, shortcutById, NAMED_KEYS;
var init_manager = __esm({
  "src/tui/shortcuts/manager.ts"() {
    "use strict";
    SHORTCUTS = [
      {
        id: "palette",
        label: "Command palette",
        keys: ["ctrl+p", "ctrl+k"],
        description: "Search and run every command.",
        scope: "global",
        customizable: true
      },
      {
        id: "model",
        label: "Model selector",
        keys: ["ctrl+m", "ctrl+g"],
        description: "Open the searchable model picker.",
        scope: "global",
        customizable: true
      },
      {
        id: "provider",
        label: "Provider manager",
        keys: ["ctrl+b"],
        description: "Open the provider connection and profile manager.",
        scope: "global",
        customizable: true
      },
      {
        id: "effort",
        label: "Reasoning effort",
        keys: ["ctrl+e"],
        description: "Choose low/medium/default/high/xhigh effort for the active profile.",
        scope: "global",
        customizable: true
      },
      {
        id: "newTask",
        label: "New task",
        keys: ["ctrl+n"],
        description: "Start a fresh task in the workspace.",
        scope: "global",
        customizable: true
      },
      {
        id: "clear",
        label: "Clear transcript",
        keys: ["ctrl+l"],
        description: "Clear the conversation view; history is kept.",
        scope: "global",
        customizable: true
      },
      {
        id: "tasks",
        label: "Task manager",
        keys: ["ctrl+t"],
        description: "Search, resume, rename, and delete tasks.",
        scope: "global",
        customizable: true
      },
      {
        id: "tools",
        label: "Toggle tool details",
        keys: ["ctrl+o"],
        description: "Expand or collapse tool arguments and output.",
        scope: "workspace",
        customizable: true
      },
      {
        id: "status",
        label: "Status",
        keys: ["ctrl+s"],
        description: "Provider, quota, routing, and git status.",
        scope: "global",
        customizable: true
      },
      {
        id: "cancel",
        label: "Pause / cancel",
        keys: ["escape"],
        description: "Pause the running task; close a dialog first.",
        scope: "workspace",
        customizable: false
      },
      {
        id: "quit",
        label: "Quit or cancel",
        keys: ["ctrl+c"],
        description: "Cancel a running task or quit when idle.",
        scope: "global",
        customizable: false
      },
      {
        id: "screens",
        label: "Switch screens",
        keys: ["left", "right", "tab", "shift+tab"],
        description: "There is a single workspace; everything else opens as a dialog.",
        scope: "workspace",
        customizable: false
      },
      {
        id: "scroll",
        label: "Scroll transcript",
        keys: ["pageup", "pagedown"],
        description: "Move through conversation history one screen at a time.",
        scope: "workspace",
        customizable: false
      },
      {
        id: "select",
        label: "Text selection / copy",
        keys: ["ctrl+y"],
        description: "Release mouse capture so you can highlight and copy text anywhere; esc returns to wheel scrolling.",
        scope: "global",
        customizable: true
      },
      {
        id: "confirm",
        label: "Approve / reject",
        keys: ["y", "n"],
        description: "Answer a confirmation or undo dialog.",
        scope: "dialog",
        customizable: false
      },
      {
        id: "close",
        label: "Close dialog",
        keys: ["escape"],
        description: "Close any dialog without applying changes.",
        scope: "dialog",
        customizable: false
      }
    ];
    shortcutById = new Map(SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));
    NAMED_KEYS = {
      esc: "escape",
      escape: "escape",
      enter: "return",
      return: "return",
      tab: "tab",
      backspace: "backspace",
      delete: "delete",
      del: "delete",
      up: "up",
      down: "down",
      left: "left",
      right: "right",
      pageup: "pageup",
      pgup: "pageup",
      pagedown: "pagedown",
      pgdn: "pagedown",
      space: " ",
      question: "?"
    };
  }
});

// src/tui/dialogs/shortcuts-dialog.tsx
import "react";
import { Box as Box15, Text as Text15, useInput as useInput13 } from "ink";
import { jsx as jsx16 } from "react/jsx-runtime";
function ShortcutsDialog({ onClose }) {
  useInput13((_input, key) => {
    if (key.escape) onClose();
  });
  const lines = shortcutLines();
  return /* @__PURE__ */ jsx16(
    ModalWindow,
    {
      title: "KEYBOARD SHORTCUTS",
      subtitle: `${lines.length} shortcuts`,
      width: 70,
      height: 18,
      borderColor: theme.accent,
      footer: ["esc close"],
      children: /* @__PURE__ */ jsx16(Box15, { flexDirection: "column", flexGrow: 1, overflow: "hidden", children: lines.map((line, idx) => {
        const isCategory = line === "GLOBAL" || line === "WORKSPACE" || line === "DIALOGS";
        return /* @__PURE__ */ jsx16(
          Text15,
          {
            color: isCategory ? theme.accent : theme.text,
            bold: isCategory,
            wrap: "truncate",
            children: line || " "
          },
          idx
        );
      }) })
    }
  );
}
var init_shortcuts_dialog = __esm({
  "src/tui/dialogs/shortcuts-dialog.tsx"() {
    "use strict";
    init_manager();
    init_theme();
    init_modal();
  }
});

// src/tui/dialogs/output-dialog.tsx
import { useState as useState13 } from "react";
import { Box as Box16, Text as Text16, useInput as useInput14 } from "ink";
import { jsx as jsx17, jsxs as jsxs14 } from "react/jsx-runtime";
function OutputDialog({ title, text, onClose }) {
  const { rows } = useLayout();
  const lines = text.replace(/\t/g, "  ").split("\n");
  const height = Math.min(rows - 4, 30);
  const inner = Math.max(4, height - 7);
  const maxOffset = Math.max(0, lines.length - inner);
  const [offset, setOffset] = useState13(0);
  useInput14((_input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) setOffset((value) => Math.max(0, value - 1));
    else if (key.downArrow) setOffset((value) => Math.min(maxOffset, value + 1));
    else if (key.pageUp) setOffset((value) => Math.max(0, value - inner));
    else if (key.pageDown) setOffset((value) => Math.min(maxOffset, value + inner));
    else if (key.home) setOffset(0);
    else if (key.end) setOffset(maxOffset);
  });
  const clamped = Math.min(offset, maxOffset);
  const visible = lines.slice(clamped, clamped + inner);
  return /* @__PURE__ */ jsx17(
    ModalWindow,
    {
      title: title.toUpperCase(),
      subtitle: `${lines.length} lines \xB7 \u2191/\u2193 scroll`,
      width: 72,
      height,
      footer: ["\u2191/\u2193 scroll", "pgup/pgdn page", "esc close"],
      children: /* @__PURE__ */ jsxs14(Box16, { flexDirection: "column", flexGrow: 1, overflow: "hidden", children: [
        visible.map((line, index) => /* @__PURE__ */ jsx17(Text16, { color: theme.text, wrap: "truncate", children: line || " " }, clamped + index)),
        clamped > 0 || clamped + inner < lines.length ? /* @__PURE__ */ jsx17(Text16, { color: theme.faint, children: `  \u22EF ${clamped + 1}-${Math.min(clamped + inner, lines.length)} of ${lines.length}` }) : null
      ] })
    }
  );
}
var init_output_dialog = __esm({
  "src/tui/dialogs/output-dialog.tsx"() {
    "use strict";
    init_components();
    init_theme();
    init_modal();
  }
});

// src/tui/dialogs/effort-dialog.tsx
import { useMemo as useMemo9, useState as useState14 } from "react";
import { jsx as jsx18 } from "react/jsx-runtime";
function EffortDialog({
  context,
  onClose,
  notify,
  refreshData
}) {
  const [query, setQuery] = useState14("");
  const profileId = context.store.getSelectedProfileId();
  const profile = profileId ? context.store.getProfile(profileId) : null;
  const current = typeof profile?.config?.effort === "string" ? profile.config.effort : "default";
  const items = useMemo9(
    () => EFFORTS.map((effort) => ({
      key: effort,
      label: effort,
      detail: DESCRIPTIONS[effort],
      badge: effort === current ? "current" : void 0,
      badgeColor: void 0
    })),
    [current]
  );
  const filtered = useMemo9(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) => item.label.toLowerCase().includes(needle) || (item.detail ?? "").toLowerCase().includes(needle)
    );
  }, [items, query]);
  const [selected, setSelected] = useState14(
    () => Math.max(
      0,
      items.findIndex((item) => item.key === current)
    )
  );
  const apply = (effort) => {
    if (!profile) {
      notify("No provider profile selected \u2014 connect a provider first.");
      onClose();
      return;
    }
    context.store.updateProfile(profile.id, {
      config: { ...profile.config, effort }
    });
    notify(`Effort set to ${effort} for ${profile.name}.`);
    refreshData();
    onClose();
  };
  return /* @__PURE__ */ jsx18(
    Selector,
    {
      title: "REASONING EFFORT",
      subtitle: profile ? `profile: ${profile.name}` : "no profile selected",
      items: filtered,
      query,
      onQueryChange: setQuery,
      selected: Math.min(selected, Math.max(0, filtered.length - 1)),
      onSelectedChange: setSelected,
      onSelect: (item) => apply(item.key),
      onClose,
      searchPlaceholder: "Filter effort\u2026",
      emptyText: "No matching effort level.",
      footer: ["\u2191/\u2193 choose", "enter apply", "esc close"]
    }
  );
}
var EFFORTS, DESCRIPTIONS;
var init_effort_dialog = __esm({
  "src/tui/dialogs/effort-dialog.tsx"() {
    "use strict";
    init_selector();
    EFFORTS = ["low", "medium", "default", "high", "xhigh"];
    DESCRIPTIONS = {
      low: "Fewest tokens \u2014 tight context, few steps, small tool output",
      medium: "Lean \u2014 smaller context budget and fewer agent steps",
      default: "Balanced \u2014 uses the global agent settings",
      high: "Deeper \u2014 larger context, more steps, bigger tool outputs",
      xhigh: "Maximum depth \u2014 largest context and step budget"
    };
  }
});

// src/tui/app.tsx
var app_exports = {};
__export(app_exports, {
  App: () => App,
  runTui: () => runTui
});
import { useCallback as useCallback4, useEffect as useEffect10, useMemo as useMemo10, useRef as useRef4, useState as useState15 } from "react";
import { Box as Box17, Text as Text17, render, useApp, useInput as useInput15 } from "ink";
import { jsx as jsx19, jsxs as jsxs15 } from "react/jsx-runtime";
function App({ context }) {
  const { exit } = useApp();
  const { columns, rows } = useLayout();
  setActiveTheme(context.store.getSettings().ui.theme);
  const [status, setStatus] = useState15("idle");
  const [tick, setTick] = useState15(0);
  const [toast, setToast] = useState15(null);
  const [resumeRequest, setResumeRequest] = useState15(null);
  const [dialogStack, setDialogStack] = useState15([]);
  const [paletteQuery, setPaletteQuery] = useState15("");
  const [paletteIndex, setPaletteIndex] = useState15(0);
  const [branch, setBranch] = useState15(null);
  const [agentMode, setAgentMode] = useState15("auto");
  const [outputContent, setOutputContent] = useState15(null);
  const [selectionMode, setSelectionMode] = useState15(false);
  const quitArmedAt = useRef4(0);
  const activeDialog = dialogStack.length > 0 ? dialogStack[dialogStack.length - 1] : null;
  const isDialogOpen = activeDialog !== null;
  const openDialog = useCallback4((id) => {
    setDialogStack((stack) => stack[stack.length - 1] === id ? stack : [...stack, id]);
  }, []);
  const closeDialog = useCallback4(() => {
    setDialogStack((stack) => stack.slice(0, -1));
  }, []);
  const closeAllDialogs = useCallback4(() => setDialogStack([]), []);
  const showOutput = useCallback4(
    (title, text) => {
      setOutputContent({ title, text });
      openDialog("output");
    },
    [openDialog]
  );
  const refreshData = useCallback4(() => setTick((value) => value + 1), []);
  const notify = useCallback4((message) => {
    setToast(message);
    setTick((value) => value + 1);
  }, []);
  const toggleSelectionMode = useCallback4(() => {
    const next = !selectionMode;
    setSelectionMode(next);
    notify(
      next ? "Select mode on \u2014 drag to highlight text and copy anywhere. Esc or ctrl+y returns to wheel scrolling." : "Wheel scrolling restored."
    );
  }, [notify, selectionMode]);
  useEffect10(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5e3);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect10(() => enableAlternateScroll(), []);
  useEffect10(() => {
    if (context.store.getSettings().ui.mouseScroll !== true) return;
    if (context.store.db.metaGet("ui.mouse_tip_v1")) return;
    context.store.db.metaSet("ui.mouse_tip_v1", "1");
    notify("Mouse scroll on \u2014 hold Shift+drag or press ctrl+y to highlight and copy text.");
  }, [context, notify]);
  useEffect10(() => {
    let active = true;
    void gitBranch(context.cwd).then((b) => {
      if (active) setBranch(b);
    });
    return () => {
      active = false;
    };
  }, [context.cwd, tick]);
  const openTask = useCallback4(
    (taskId, resume) => {
      setResumeRequest({ taskId, nonce: Date.now(), resume });
      closeAllDialogs();
    },
    [closeAllDialogs]
  );
  const quit = useCallback4(() => {
    exit();
  }, [exit]);
  const togglePaid = useCallback4(() => {
    context.store.updateSettings((settings) => {
      settings.routing.allowPaid = !settings.routing.allowPaid;
      return settings;
    });
    const enabled = context.store.getSettings().routing.allowPaid;
    notify(`Paid fallbacks ${enabled ? "enabled" : "disabled"} for future runs.`);
    refreshData();
  }, [context, notify, refreshData]);
  const latestPaused = useCallback4(() => {
    return context.store.listTasks({ projectPath: context.cwd, limit: 100 }).find((task) => task.status === "paused" || task.status === "failed") ?? null;
  }, [context]);
  const paletteActions = useMemo10(
    () => [
      {
        label: "Select an AI model",
        detail: "model-picker (ctrl+m)",
        run: () => openDialog("model-picker")
      },
      {
        label: "Choose reasoning effort",
        detail: "effort (ctrl+e) or /profile",
        run: () => openDialog("effort")
      },
      {
        label: "Manage providers & profiles",
        detail: "providers (ctrl+b)",
        run: () => openDialog("providers")
      },
      {
        label: "Connect a new provider",
        detail: "connect",
        run: () => openDialog("connect")
      },
      {
        label: "Manage active & saved tasks",
        detail: "tasks (ctrl+t)",
        run: () => openDialog("tasks")
      },
      {
        label: "View token usage & limits",
        detail: "usage",
        run: () => openDialog("usage")
      },
      {
        label: "View git diff for task",
        detail: "diff",
        run: () => openDialog("diff")
      },
      {
        label: "Safe undo task changes",
        detail: "undo",
        run: () => openDialog("undo")
      },
      {
        label: "View system and quota status",
        detail: "status (ctrl+s)",
        run: () => openDialog("status")
      },
      {
        label: "Open settings",
        detail: "settings",
        run: () => openDialog("settings")
      },
      {
        label: "Show keyboard shortcuts",
        detail: "shortcuts (?)",
        run: () => openDialog("shortcuts")
      },
      {
        label: "Refresh all model catalogs",
        detail: "models",
        run: async () => {
          const profiles2 = context.store.listProfiles().filter((profile) => profile.enabled);
          let discovered = 0;
          for (const profile of profiles2) {
            try {
              const result = await refreshProfileModels(context.store, profile);
              discovered += result.discovered;
            } catch {
            }
          }
          notify(`Refreshed ${discovered} models across ${profiles2.length} profiles.`);
          refreshData();
        }
      },
      {
        label: "Resume the latest paused task",
        detail: "history",
        run: () => {
          const task = latestPaused();
          if (!task) {
            notify("There is no paused task to resume.");
            return;
          }
          openTask(task.id, true);
        }
      },
      {
        label: "Cycle agent mode (build/plan/debug)",
        detail: "tab",
        run: () => setAgentMode((mode) => nextAgentMode(mode, 1))
      },
      {
        label: "Toggle paid fallbacks",
        detail: "settings",
        run: () => togglePaid()
      },
      {
        label: "Start a fresh task",
        detail: "new (ctrl+n)",
        run: () => {
          setResumeRequest(null);
          notify("Ready for a new task.");
          refreshData();
        }
      },
      { label: "Quit ComiCode", detail: "exit", run: () => quit() }
    ],
    [context, latestPaused, notify, openDialog, openTask, quit, refreshData, togglePaid]
  );
  const filteredActions = useMemo10(() => {
    const needle = paletteQuery.trim().toLowerCase();
    if (!needle) return paletteActions;
    return paletteActions.filter(
      (action) => action.label.toLowerCase().includes(needle) || action.detail.toLowerCase().includes(needle)
    );
  }, [paletteActions, paletteQuery]);
  useEffect10(() => {
    setPaletteIndex((value) => Math.min(value, Math.max(0, filteredActions.length - 1)));
  }, [filteredActions.length]);
  useInput15((input, key) => {
    const shortcutOverrides = context.store.getSettings().ui.shortcuts;
    if (shortcutMatches("select", input, key, shortcutOverrides)) {
      toggleSelectionMode();
      return;
    }
    if (isDialogOpen) return;
    if (shortcutMatches("quit", input, key, shortcutOverrides)) {
      if (status === "running") {
        notify("Pause the run with esc before quitting.");
        return;
      }
      const now = Date.now();
      if (now - quitArmedAt.current < 2e3) {
        quitArmedAt.current = 0;
        quit();
        return;
      }
      quitArmedAt.current = now;
      notify("Press ctrl+c again to quit.");
      return;
    }
    if (shortcutMatches("palette", input, key, shortcutOverrides)) {
      openDialog("palette");
      setPaletteQuery("");
      setPaletteIndex(0);
      return;
    }
    if (shortcutMatches("model", input, key, shortcutOverrides)) {
      openDialog("model-picker");
      return;
    }
    if (shortcutMatches("provider", input, key, shortcutOverrides)) {
      openDialog("providers");
      return;
    }
    if (shortcutMatches("tasks", input, key, shortcutOverrides)) {
      openDialog("tasks");
      return;
    }
    if (shortcutMatches("status", input, key, shortcutOverrides)) {
      openDialog("status");
      return;
    }
    if (shortcutMatches("effort", input, key, shortcutOverrides)) {
      openDialog("effort");
      return;
    }
    if (shortcutMatches("newTask", input, key, shortcutOverrides)) {
      setResumeRequest(null);
      notify("Ready for a new task.");
      refreshData();
      return;
    }
  });
  useInput15(
    (_input, key) => {
      if (key.escape) {
        closeDialog();
        setPaletteQuery("");
        return;
      }
      const count = filteredActions.length;
      if (key.upArrow) {
        setPaletteIndex((value) => count === 0 ? 0 : (value - 1 + count) % count);
      } else if (key.downArrow) {
        setPaletteIndex((value) => count === 0 ? 0 : (value + 1) % count);
      }
    },
    { isActive: activeDialog === "palette" }
  );
  const runPaletteAction = (index) => {
    const action = filteredActions[index];
    closeDialog();
    setPaletteQuery("");
    if (action) void action.run();
  };
  const profiles = context.store.listProfiles();
  const selectedProfile = profiles.find((profile) => profile.id === context.store.getSelectedProfileId()) ?? profiles.find((profile) => profile.enabled) ?? null;
  const allowPaid = context.store.getSettings().routing.allowPaid;
  const hints = isDialogOpen ? ["\u2191/\u2193 navigate", "enter select", "esc close"] : [
    "/ commands",
    "enter send",
    "tab mode",
    "esc pause",
    "ctrl+k palette",
    "ctrl+m model",
    "ctrl+b providers",
    "ctrl+y select/copy",
    "ctrl+c\xD72 quit"
  ];
  void tick;
  const paletteRows = Math.max(4, rows - 14);
  const paletteStart = Math.max(
    0,
    Math.min(
      paletteIndex - Math.floor(paletteRows / 2),
      Math.max(0, filteredActions.length - paletteRows)
    )
  );
  return /* @__PURE__ */ jsxs15(Box17, { flexDirection: "column", height: rows, width: columns, overflow: "hidden", children: [
    /* @__PURE__ */ jsx19(
      Header,
      {
        version: VERSION,
        cwd: context.cwd,
        profileName: selectedProfile?.name ?? null,
        status,
        allowPaid,
        taskId: resumeRequest?.taskId ?? null,
        branch,
        columns,
        dimmed: isDialogOpen,
        agentMode
      }
    ),
    /* @__PURE__ */ jsx19(Box17, { flexDirection: "column", flexGrow: 1, overflow: "hidden", paddingX: 1, children: /* @__PURE__ */ jsx19(
      Workspace,
      {
        context,
        active: !isDialogOpen,
        dimmed: isDialogOpen,
        onStatusChange: setStatus,
        onNavigate: () => {
        },
        onCycleScreen: () => {
        },
        onOpenDialog: (d) => {
          if (d) openDialog(d);
          else closeDialog();
        },
        onQuit: quit,
        resumeRequest,
        notify,
        refreshData,
        agentMode,
        onAgentMode: setAgentMode,
        onShowOutput: showOutput,
        selectionMode,
        onToggleSelection: toggleSelectionMode
      }
    ) }),
    activeDialog === "palette" ? /* @__PURE__ */ jsxs15(
      ModalWindow,
      {
        title: "COMMAND PALETTE",
        subtitle: `${filteredActions.length} actions`,
        width: 76,
        height: Math.max(10, rows - 8),
        footer: ["type to filter", "\u2191/\u2193 choose", "enter run", "esc close"],
        children: [
          /* @__PURE__ */ jsx19(Box17, { marginBottom: 1, flexShrink: 0, children: /* @__PURE__ */ jsx19(
            PromptInput,
            {
              value: paletteQuery,
              onChange: (value) => {
                setPaletteQuery(value);
                setPaletteIndex(0);
              },
              onSubmit: () => runPaletteAction(paletteIndex),
              focus: true,
              placeholder: "Search commands, providers, models, tasks\u2026"
            }
          ) }),
          /* @__PURE__ */ jsx19(Box17, { flexDirection: "column", flexGrow: 1, overflow: "hidden", children: filteredActions.length === 0 ? /* @__PURE__ */ jsx19(Text17, { color: theme.muted, children: "No matching actions." }) : filteredActions.slice(paletteStart, paletteStart + paletteRows).map((action, offset) => {
            const index = paletteStart + offset;
            const selected = index === paletteIndex;
            return /* @__PURE__ */ jsxs15(Box17, { children: [
              /* @__PURE__ */ jsxs15(
                Text17,
                {
                  color: selected ? theme.black : theme.text,
                  backgroundColor: selected ? theme.accent : void 0,
                  bold: selected,
                  children: [
                    selected ? ` ${glyph.active} ` : "   ",
                    action.label,
                    "  "
                  ]
                }
              ),
              /* @__PURE__ */ jsx19(Text17, { color: selected ? theme.black : theme.faint, children: action.detail })
            ] }, action.label);
          }) })
        ]
      }
    ) : null,
    activeDialog === "model-picker" ? /* @__PURE__ */ jsx19(
      ModelPicker,
      {
        context,
        onClose: closeDialog,
        notify,
        refreshData
      }
    ) : null,
    activeDialog === "connect" ? /* @__PURE__ */ jsx19(
      ConnectDialog,
      {
        context,
        onClose: closeDialog,
        onConnected: (profile) => {
          notify(`Connected ${profile.name}.`);
          refreshData();
        },
        notify,
        refreshData
      }
    ) : null,
    activeDialog === "providers" ? /* @__PURE__ */ jsx19(
      ProvidersDialog,
      {
        context,
        onClose: closeDialog,
        notify,
        refreshData,
        onStatusChange: setStatus,
        onRequestConnect: () => setDialogStack((stack) => [...stack.slice(0, -1), "connect"])
      }
    ) : null,
    activeDialog === "tasks" ? /* @__PURE__ */ jsx19(
      TasksDialog,
      {
        context,
        onClose: closeDialog,
        onOpenTask: (taskId, resume) => openTask(taskId, resume),
        onNewTask: () => {
          setResumeRequest(null);
          notify("Ready for a new task.");
        },
        notify,
        refreshData
      }
    ) : null,
    activeDialog === "diff" ? /* @__PURE__ */ jsx19(
      DiffDialog,
      {
        context,
        taskId: resumeRequest?.taskId ?? null,
        onClose: closeDialog
      }
    ) : null,
    activeDialog === "undo" ? /* @__PURE__ */ jsx19(
      UndoDialog,
      {
        context,
        taskId: resumeRequest?.taskId ?? null,
        onClose: closeDialog,
        notify,
        refreshData
      }
    ) : null,
    activeDialog === "status" ? /* @__PURE__ */ jsx19(
      StatusDialog,
      {
        context,
        taskId: resumeRequest?.taskId ?? null,
        onClose: closeDialog
      }
    ) : null,
    activeDialog === "usage" ? /* @__PURE__ */ jsx19(
      UsageDialog,
      {
        context,
        onClose: closeDialog,
        notify,
        refreshData
      }
    ) : null,
    activeDialog === "settings" ? /* @__PURE__ */ jsx19(
      SettingsDialog,
      {
        context,
        onClose: closeDialog,
        notify,
        refreshData
      }
    ) : null,
    activeDialog === "shortcuts" ? /* @__PURE__ */ jsx19(ShortcutsDialog, { onClose: closeDialog }) : null,
    activeDialog === "output" && outputContent ? /* @__PURE__ */ jsx19(OutputDialog, { title: outputContent.title, text: outputContent.text, onClose: closeDialog }) : null,
    activeDialog === "effort" ? /* @__PURE__ */ jsx19(
      EffortDialog,
      {
        context,
        onClose: closeDialog,
        notify,
        refreshData
      }
    ) : null,
    /* @__PURE__ */ jsx19(Footer, { hints, toast, width: columns })
  ] });
}
async function runTui() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("The ComiCode TUI needs an interactive terminal. Use `comicode run` instead.");
  }
  const context = openAppContext(process.cwd());
  setActiveTheme(context.store.getSettings().ui.theme);
  process.stdout.write("\x1B]0;ComiCode\x07");
  let instance = null;
  try {
    instance = render(/* @__PURE__ */ jsx19(App, { context }), {
      // Render inline (not the alternate screen) so conhost/Command Prompt
      // and other terminals keep native text selection and scrollback.
      alternateScreen: false,
      exitOnCtrlC: false,
      incrementalRendering: false,
      maxFps: 30
    });
    await instance.waitUntilExit();
  } finally {
    try {
      instance?.unmount();
    } catch {
    }
    try {
      context.close();
    } catch {
    }
  }
}
var init_app2 = __esm({
  "src/tui/app.tsx"() {
    "use strict";
    init_app();
    init_service();
    init_repository();
    init_components();
    init_workspace();
    init_providers_dialog();
    init_model_picker();
    init_connect_dialog();
    init_tasks_dialog();
    init_diff_dialog();
    init_undo_dialog();
    init_status_dialog();
    init_usage_dialog();
    init_settings_dialog();
    init_shortcuts_dialog();
    init_output_dialog();
    init_effort_dialog();
    init_modal();
    init_manager();
    init_modes();
    init_version();
    init_theme();
    init_mouse();
  }
});

// src/main.ts
var main_exports = {};
__export(main_exports, {
  buildProgram: () => buildProgram,
  main: () => main
});
import { Command, Option } from "commander";
import { stdin as stdin2, stdout as stdout2 } from "process";
function authorityFlags(command) {
  return command.option("--yes", "approve file edits without prompting").option("--allow-commands", "allow running shell commands").option("--allow-dangerous-commands", "allow risky shell commands (also required for them)").option("--allow-secrets", "allow reading protected/secret files").option("--allow-paid", "allow paid fallback models for this run only");
}
function maxSteps(value) {
  if (value === void 0) return void 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new Error("--max-steps must be an integer between 1 and 200.");
  }
  return parsed;
}
function selectedModelReference(store, flags) {
  const profile = flags.profile ? resolveProfile(store, flags.profile) : null;
  if (flags.model) {
    const resolved = resolveModel(store, flags.model, flags.profile);
    return {
      profileId: resolved.profile.id,
      modelId: resolved.model.modelId,
      profileName: resolved.profile.name
    };
  }
  if (profile) {
    return {
      profileId: profile.id,
      modelId: profile.defaultModel,
      profileName: profile.name
    };
  }
  return { profileId: null, modelId: null, profileName: null };
}
function reportResult(result) {
  printResumeHint(result);
  process.exitCode = resultExitCode(result);
}
async function runCommand(parts, flags) {
  const request = parts.join(" ").trim();
  if (!request) {
    throw new Error('Provide a request. Example: comicode run "fix the failing tests"');
  }
  await withStore(async ({ store, cwd }) => {
    const target = selectedModelReference(store, flags);
    const task = createTaskForRequest(store, cwd, request, {
      taskType: normalizeTaskType(flags.type),
      profileId: target.profileId,
      modelId: target.modelId
    });
    if (flags.json) {
      reportResult(await runTask(store, task.id, { ...flags, maxSteps: maxSteps(flags.maxSteps) }));
      return;
    }
    console.log("");
    console.log(`${bold("COMICODE")} ${dim(`task ${task.id.slice(0, 8)} \xB7 ${cwd}`)}`);
    console.log(dim(`request: ${request}`));
    reportResult(await runTask(store, task.id, { ...flags, maxSteps: maxSteps(flags.maxSteps) }));
  });
}
async function resumeCommand(reference, flags) {
  await withStore(async ({ store, cwd }) => {
    const tasks = store.listTasks({ limit: 1e3 });
    let exact = null;
    if (reference) {
      exact = tasks.find((task) => task.id === reference) ?? (() => {
        const matches = tasks.filter((task) => task.id.startsWith(reference));
        if (matches.length === 1) return matches[0];
        if (matches.length > 1) throw new Error(`Task id "${reference}" is ambiguous.`);
        return null;
      })();
    } else {
      exact = tasks.find(
        (task) => task.projectPath === cwd && (task.status === "paused" || task.status === "failed")
      ) ?? tasks.find((task) => task.status === "paused" || task.status === "failed") ?? null;
      if (!exact) {
        throw new Error("No paused or interrupted task found to resume.");
      }
    }
    if (!exact) throw new Error(`Task not found: ${reference}`);
    if (exact.status === "completed") {
      throw new Error("This task is already completed. Start a new task instead.");
    }
    if (exact.status === "cancelled") {
      throw new Error("This task was cancelled and cannot be resumed. Start a new task instead.");
    }
    if (!flags.json) {
      console.log("");
      console.log(
        `${bold("COMICODE")} ${dim(`resume ${exact.id.slice(0, 8)} \xB7 ${exact.projectPath}`)}`
      );
      console.log(dim(`request: ${exact.userRequest}`));
    }
    reportResult(
      await runTask(store, exact.id, {
        ...flags,
        resume: true,
        maxSteps: maxSteps(flags.maxSteps)
      })
    );
  });
}
async function launchChat(flags) {
  if (!isInteractive()) {
    throw new Error(
      'The chat REPL requires an interactive terminal. Use "comicode run" for scripts.'
    );
  }
  await withStore(async ({ store, cwd }) => {
    const target = selectedModelReference(store, flags);
    const taskType = normalizeTaskType(flags.type);
    let task = null;
    console.log("");
    console.log(
      `${bold("COMICODE")} ${dim("chat \xB7 /exit to quit, /new to start a fresh task, /tasks to list")}`
    );
    const request = await promptText("You", { required: true });
    if (!request.trim() || request.trim() === "/exit") return;
    task = createTaskForRequest(store, cwd, request, {
      taskType,
      profileId: target.profileId,
      modelId: target.modelId
    });
    let result = await runTask(store, task.id, { ...flags, maxSteps: maxSteps(flags.maxSteps) });
    while (result.status === "completed") {
      const next = await promptText("You", { allowEmpty: true, defaultValue: "/exit" });
      const trimmed = next.trim();
      if (!trimmed || trimmed === "/exit" || trimmed === "/quit") break;
      if (trimmed === "/new") {
        const fresh = await promptText("New task", { required: true });
        task = createTaskForRequest(store, cwd, fresh, {
          taskType,
          profileId: target.profileId,
          modelId: target.modelId
        });
      } else if (trimmed === "/tasks") {
        for (const entry of store.listTasks({ projectPath: cwd, limit: 10 })) {
          console.log(
            dim(`  ${entry.id.slice(0, 8)}  ${entry.status}  ${entry.userRequest.slice(0, 60)}`)
          );
        }
        continue;
      } else {
        if (!task) break;
        store.appendMessage(task.id, { role: "user", content: trimmed });
        store.updateTask(task.id, {
          status: "running",
          phase: "implement",
          completedAt: null
        });
      }
      result = await runTask(store, task.id, { ...flags, maxSteps: maxSteps(flags.maxSteps) });
    }
    if (result.status === "paused") printResumeHint(result);
  });
}
function buildProgram() {
  const program = new Command();
  program.name("comicode").description("Multi-provider AI coding agent with quota-aware routing and persistent tasks").version(VERSION, "-v, --version", "print the ComiCode version").showHelpAfterError().configureHelp({ sortSubcommands: true });
  program.command("run <request...>").description("Run a coding task in the current project").option("-p, --profile <profile>", "provider profile to start with").option("-m, --model <model>", "model to start with (explicit selections are honored)").option("-t, --type <type>", "coding, reasoning, review, vision, or general", "coding").option("--max-steps <number>", "maximum agent steps for this run").option("--json", "emit a single JSON result instead of streaming output").action(async (parts, flags) => {
    await runCommand(parts, flags);
  });
  program.command("task <request...>").description("Run a coding task in the current project (alias for run)").option("-p, --profile <profile>", "provider profile to start with").option("-m, --model <model>", "model to start with (explicit selections are honored)").option("-t, --type <type>", "coding, reasoning, review, vision, or general", "coding").option("--max-steps <number>", "maximum agent steps for this run").option("--json", "emit a single JSON result instead of streaming output").action(async (parts, flags) => {
    await runCommand(parts, flags);
  });
  program.command("resume [task]").description("Resume a paused or interrupted task").option("--max-steps <number>", "maximum agent steps for this run").option("--json", "emit a single JSON result instead of streaming output").action(async (reference, flags) => {
    await resumeCommand(reference, flags);
  });
  program.command("connect").description("Connect an AI provider profile (interactive or flagged)").option("--provider <kind>", "gemini, groq, openrouter, openai, or custom").option("--name <name>", "profile name").option("--api-key <key>", "API key").option("--base-url <url>", "API base URL").action(async (options) => {
    const { addProvider: addProvider2 } = await Promise.resolve().then(() => (init_providers(), providers_exports));
    await addProvider2(options);
  });
  program.command("status").description("Show provider, quota, model, and git status").option("--json", "machine-readable output").action(async (options) => {
    await withStore(async ({ store, cwd }) => {
      const { gitSummary: gitSummary2 } = await Promise.resolve().then(() => (init_repository(), repository_exports));
      const { jsonOut: jsonOut2, printKeyValue: printKeyValue2, printSection: printSection2, success: success2, warning: warning2, danger: danger2 } = await Promise.resolve().then(() => (init_output(), output_exports));
      const profiles = store.listProfiles();
      const activeProfileId = store.getSelectedProfileId();
      const activeModelId = store.getSelectedModelId();
      const limits2 = store.listLimits(true);
      const settings = store.getSettings();
      const git = await gitSummary2(cwd);
      if (options.json) {
        jsonOut2({
          selectedProfileId: activeProfileId,
          selectedModelId: activeModelId,
          profiles,
          limits: limits2,
          allowPaid: settings.routing.allowPaid,
          git
        });
        return;
      }
      printSection2("ComiCode Status");
      const activeProfile = profiles.find((p) => p.id === activeProfileId);
      printKeyValue2([
        ["Selected Profile", activeProfile ? activeProfile.name : dim("(none selected)")],
        ["Selected Model", activeModelId ?? dim("(provider default)")],
        [
          "Paid Fallbacks",
          settings.routing.allowPaid ? warning2("enabled") : success2("disabled (free only)")
        ],
        ["Connected Profiles", `${profiles.length} connected`],
        [
          "Active Limits",
          limits2.length === 0 ? success2("none") : danger2(`${limits2.length} active limits`)
        ],
        [
          "Git Repository",
          git.repository ? git.clean ? success2(`clean (\u2387 ${git.branch ?? "HEAD"})`) : warning2(`modified (\u2387 ${git.branch ?? "HEAD"}, ${git.files.length} changed)`) : dim("not a git repository")
        ]
      ]);
    });
  });
  program.command("chat").description("Start a multi-turn coding conversation in this project").option("-p, --profile <profile>", "provider profile to start with").option("-m, --model <model>", "model to start with").option("-t, --type <type>", "coding, reasoning, review, vision, or general", "coding").option("--max-steps <number>", "maximum agent steps per turn").action(async (flags) => {
    await launchChat(flags);
  });
  for (const command of program.commands) {
    if (["run", "task", "resume", "chat"].includes(command.name())) authorityFlags(command);
  }
  registerProviderCommands(program);
  registerModelCommands(program);
  registerTaskCommands(program);
  registerUsageCommands(program);
  registerSettingsCommands(program);
  registerSystemCommands(program);
  program.command("bench").description("Run honest micro-benchmarks (startup, memory, context build, tokens)").option("-n, --iterations <number>", "samples per metric", "5").action(async (options) => {
    const iterations = Math.max(1, Math.min(50, Number(options.iterations) || 5));
    const { runBenchmarks: runBenchmarks2 } = await Promise.resolve().then(() => (init_bench(), bench_exports));
    const results = await runBenchmarks2(process.cwd(), iterations);
    const width = Math.max(...results.map((r) => r.metric.length));
    for (const result of results) {
      console.log(`${result.metric.padEnd(width)}  ${String(result.value).padStart(10)} ${result.unit}`);
    }
  });
  program.command("completion").description("Print shell completion instructions").addOption(new Option("--shell <shell>", "bash, zsh, or fish").choices(["bash", "zsh", "fish"])).action((options) => {
    const shell = options.shell ?? "bash";
    console.log(dim("Shell completion is advisory; generate it from the command list:"));
    console.log(`${bold("comicode")} --help | awk '/^  [a-z]/ {print $1}' # ${shell}`);
  });
  program.action(async () => {
    if (!stdin2.isTTY || !stdout2.isTTY) {
      program.outputHelp();
      return;
    }
    const { runTui: runTui2 } = await Promise.resolve().then(() => (init_app2(), app_exports));
    await runTui2();
  });
  return program;
}
async function main(argv = process.argv) {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof Error && /process\.exit|commander\.exit/i.test(error.name)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${danger("comicode:")} ${message}`);
    if (process.env.COMICODE_DEBUG) {
      console.error(error instanceof Error ? error.stack ?? "" : "");
    }
    process.exitCode = 1;
  }
}
var init_main = __esm({
  "src/main.ts"() {
    "use strict";
    init_version();
    init_providers();
    init_models();
    init_tasks();
    init_usage();
    init_settings2();
    init_system();
    init_shared();
    init_output();
    init_prompt();
  }
});

// src/cli.ts
var originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning2, ...rest) => {
  const first = rest[0];
  const type = typeof first === "string" ? first : first && typeof first === "object" && "type" in first ? String(first.type ?? "") : "";
  const message = typeof warning2 === "string" ? warning2 : warning2.message;
  if (type === "ExperimentalWarning" && /sqlite/i.test(message)) return;
  return originalEmitWarning(warning2, ...rest);
});
process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(`comicode: ${message}`);
  if (process.env.COMICODE_DEBUG && reason instanceof Error && reason.stack) {
    console.error(reason.stack);
  }
  process.exitCode = 1;
});
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
await Promise.resolve().then(() => (init_main(), main_exports)).then((module) => module.main());
//# sourceMappingURL=cli.js.map