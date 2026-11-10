import { basename, extname } from 'node:path';

const EXACT = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.production',
  '.env.production.local',
  '.env.test',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  '.htpasswd',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials',
  'credentials.json',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  'comicode.db',
]);

const SECRET_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.pfx',
  '.p12',
  '.jks',
  '.keystore',
  '.kdbx',
  '.asc',
  '.gpg',
]);

const SENSITIVE_DIRECTORIES = [
  '.ssh/',
  '.aws/',
  '.azure/',
  '.gnupg/',
  '.docker/config.json',
  '.kube/config',
  'secrets/',
  '.secrets/',
];

/**
 * Heuristic secret-file detection. This is intentionally conservative: false
 * positives are safer than sending credentials to a model.
 */
export function isSecretFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const name = basename(normalized);
  const lower = name.toLowerCase();

  if (EXACT.has(name) || EXACT.has(lower)) return true;
  if (lower.startsWith('.env.') || lower === '.env') return true;
  if (SECRET_EXTENSIONS.has(extname(lower))) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(lower)) return !lower.endsWith('.pub');
  if (/^(credentials|secrets)[.-]/.test(lower)) return true;
  if (/\.(pem|key|pfx|p12)$/.test(lower)) return true;
  if (/(^|\/)\.(ssh|aws|gnupg|azure)\//.test(normalized)) return true;
  if (SENSITIVE_DIRECTORIES.some((segment) => normalized.includes(segment))) {
    return !normalized.endsWith('.pub');
  }
  if (/(^|\/)\.docker\/config\.json$/.test(normalized)) return true;
  if (/(^|\/)\.kube\/config$/.test(normalized)) return true;
  if (/\.(sqlite|db)$/.test(lower) && /comicode|credential|secret/i.test(lower)) return true;
  return false;
}

/** Redact secret-like values from text that is about to be shown or sent. */
export function looksLikePrivateKey(text: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/.test(text);
}
