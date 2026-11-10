import chalk from 'chalk';

export function supportsColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
}

export function bold(text: string): string {
  return supportsColor() ? chalk.bold(text) : text;
}

export function dim(text: string): string {
  return supportsColor() ? chalk.dim(text) : text;
}

export function accent(text: string): string {
  return supportsColor() ? chalk.cyan(text) : text;
}

export function success(text: string): string {
  return supportsColor() ? chalk.green(text) : text;
}

export function warning(text: string): string {
  return supportsColor() ? chalk.yellow(text) : text;
}

export function danger(text: string): string {
  return supportsColor() ? chalk.red(text) : text;
}

export function printTitle(title: string, subtitle?: string): void {
  console.log('');
  console.log(bold(`COMICODE`) + (subtitle ? `  ${dim(subtitle)}` : ''));
  console.log(
    dim('─'.repeat(Math.min(72, Math.max(20, title.length + (subtitle?.length ?? 0) + 10)))),
  );
  console.log(bold(title));
}

export function printSection(title: string): void {
  console.log('');
  console.log(bold(title));
}

export function printKeyValue(rows: Array<[string, string]>): void {
  const width = Math.min(28, Math.max(...rows.map(([key]) => key.length), 0));
  for (const [key, value] of rows) {
    console.log(`${dim(key.padEnd(width))}  ${value}`);
  }
}

export function printTable(
  headers: string[],
  rows: string[][],
  options: { maxWidth?: number } = {},
): void {
  if (rows.length === 0) {
    console.log(dim('  (none)'));
    return;
  }
  const widths = headers.map((header, index) =>
    Math.min(
      index === headers.length - 1 ? 80 : 36,
      Math.max(header.length, ...rows.map((row) => stripAnsi(row[index] ?? '').length)),
    ),
  );
  const renderRow = (cells: string[]): string =>
    cells
      .map((cell, index) => {
        const plain = stripAnsi(cell);
        const clipped =
          plain.length > widths[index]! ? `${plain.slice(0, widths[index]! - 1)}…` : plain;
        const colorized = cell.includes('\u001b') ? cell : clipped;
        const visibleLength = stripAnsi(colorized).length;
        return colorized + ' '.repeat(Math.max(0, widths[index]! - visibleLength));
      })
      .join('  ')
      .trimEnd();
  console.log(dim(renderRow(headers)));
  console.log(dim(widths.map((width) => '─'.repeat(width)).join('  ')));
  for (const row of rows) console.log(renderRow(row));
  void options;
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatTokens(count: number): string {
  if (!Number.isFinite(count)) return '0';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  const diff = Date.now() - time;
  if (diff < 0) return `in ${Math.ceil(-diff / 60000)}m`;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'completed':
      return success('completed');
    case 'running':
      return accent('running');
    case 'paused':
      return warning('paused');
    case 'failed':
      return danger('failed');
    case 'cancelled':
      return dim('cancelled');
    default:
      return status;
  }
}

export function accessLabel(access: string): string {
  switch (access) {
    case 'free-confirmed':
    case 'user-free':
      return success(access === 'user-free' ? 'user:free' : 'free');
    case 'free-tier':
      return accent('free-tier');
    case 'paid':
    case 'user-paid':
      return warning('paid');
    case 'unavailable':
      return danger('unavailable');
    default:
      return dim('unknown');
  }
}

export function truncate(text: string, max = 80): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > max ? `${singleLine.slice(0, max - 1)}…` : singleLine;
}

export function jsonOut(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
