import { PassThrough, Writable } from 'node:stream';

/** Minimal TTY-shaped stdout that records every write. */
export class FakeStdout extends Writable {
  isTTY = true;
  output = '';
  columns: number;
  rows: number;

  constructor(columns = 100, rows = 30) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.output += chunk.toString();
    callback();
  }

  clear(): void {
    this.output = '';
  }
}

export type FakeStdin = PassThrough & {
  isTTY: boolean;
  setRawMode: (mode: boolean) => void;
  ref: () => void;
  unref: () => void;
};

/** Raw-mode-capable stdin that tests can write key sequences into. */
export function makeStdin(): FakeStdin {
  const stream = new PassThrough() as FakeStdin;
  stream.isTTY = true;
  stream.setRawMode = () => {};
  stream.ref = () => {};
  stream.unref = () => {};
  return stream;
}

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_PATTERNS = [
  new RegExp(`${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`, 'g'),
  new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g'),
  new RegExp(`${ESC}[@-Z\\\\-_]`, 'g'),
];

/** Remove ANSI control sequences so frames can be asserted as plain text. */
export function stripAnsi(text: string): string {
  return ANSI_PATTERNS.reduce((current, pattern) => current.replace(pattern, ''), text);
}

export function flush(milliseconds = 80): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function screenWidths(text: string): number[] {
  return stripAnsi(text)
    .split(/\r?\n/)
    .map((line) => Array.from(line).length);
}
