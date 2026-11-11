import { execFile } from 'node:child_process';

/** Copy text to the OS clipboard using the platform's native tool. */
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
