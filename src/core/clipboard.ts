import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Copy text to the OS clipboard using the platform's native tool. */
/**
 * Copy text to the OS clipboard, falling back to a file in `.comicode/` when
 * the platform clipboard tool is unavailable (common on restricted Windows).
 */
export async function copyTextOrFile(
  text: string,
  cwd: string,
): Promise<{ ok: boolean; path?: string }> {
  if (await copyToClipboard(text)) return { ok: true };
  try {
    const dir = join(cwd, '.comicode');
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'selection.txt');
    await writeFile(path, text, 'utf8');
    return { ok: true, path };
  } catch {
    return { ok: false };
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  const { platform } = process;
  const command =
    platform === 'win32' ? 'clip' : platform === 'darwin' ? 'pbcopy' : 'xclip';
  const args = platform === 'linux' ? ['-selection', 'clipboard'] : [];
  return new Promise((resolve) => {
    const child = execFile(command, args, { timeout: 5000 }, (error) => {
      resolve(!error);
    });
    child.stdin?.on('error', () => resolve(false));
    child.stdin?.end(text);
  });
}
