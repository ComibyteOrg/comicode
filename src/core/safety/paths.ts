import { realpathSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { isSecretFile } from './secrets.js';

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathSafetyError';
  }
}

function canonical(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function normalizedForCompare(path: string): string {
  const normalized = canonical(path).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isInside(root: string, candidate: string): boolean {
  const rootNorm = normalizedForCompare(root);
  const candidateNorm = normalizedForCompare(candidate);
  return candidateNorm === rootNorm || candidateNorm.startsWith(rootNorm + sep);
}

/**
 * Confines file operations to the project root. Resolves symlinks for existing
 * files and for the nearest existing parent of new files so `..` and symlink
 * escapes are rejected.
 */
export class PathGuard {
  readonly root: string;

  constructor(root: string) {
    this.root = canonical(resolve(root));
  }

  resolvePath(input: string, options: { mustExist?: boolean } = {}): string {
    const trimmed = input?.trim();
    if (!trimmed) throw new PathSafetyError('A file path is required.');
    if (trimmed.includes('\0')) throw new PathSafetyError('Invalid path.');
    const absolute = resolve(this.root, trimmed);
    if (!isInside(this.root, absolute)) {
      throw new PathSafetyError(`Path escapes the project directory: ${trimmed}`);
    }
    if (options.mustExist) {
      let stats;
      try {
        stats = statSync(absolute);
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
    // For new files, verify the nearest existing ancestor is also inside root.
    let ancestor = absolute;
    for (let depth = 0; depth < 20; depth += 1) {
      try {
        const stats = statSync(ancestor);
        if (stats.isDirectory()) {
          const realAncestor = canonical(ancestor);
          if (!isInside(this.root, realAncestor)) {
            throw new PathSafetyError(`Path ancestor escapes the project directory: ${trimmed}`);
          }
        }
        break;
      } catch (error) {
        if (error instanceof PathSafetyError) throw error;
        const parent = resolve(ancestor, '..');
        if (parent === ancestor) break;
        ancestor = parent;
      }
    }
    return absolute;
  }

  relative(input: string): string {
    const rel = relative(this.root, this.resolvePath(input));
    return rel.split(sep).join('/') || '.';
  }

  assertNotSecret(input: string, allowSecrets: boolean): string {
    const absolute = this.resolvePath(input);
    const rel = this.relative(absolute);
    if (!allowSecrets && isSecretFile(rel)) {
      throw new PathSafetyError(
        `Refusing to access protected secret file "${rel}". Enable secret access explicitly if this is intentional.`,
      );
    }
    return absolute;
  }

  assertWritable(input: string): string {
    const absolute = this.resolvePath(input);
    const rel = this.relative(absolute);
    if (
      rel === '.git' ||
      rel.startsWith('.git/') ||
      rel === '.comicode' ||
      rel.startsWith('.comicode/')
    ) {
      throw new PathSafetyError(`Refusing to modify internal path "${rel}".`);
    }
    if (isSecretFile(rel)) {
      throw new PathSafetyError(
        `Refusing to modify protected secret file "${rel}". Edit credentials manually if required.`,
      );
    }
    return absolute;
  }
}
