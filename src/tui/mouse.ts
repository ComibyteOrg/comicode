/**
 * Wheel-only mouse support. Enables SGR mouse reporting (press/release +
 * wheel, no motion/drag events) and parses wheel sequences from stdin.
 *
 * The sequences still reach Ink's keypress parser, so consumers must guard
 * their input handlers with `isMouseSequence` / `isSuppressedInput`.
 */

// eslint-disable-next-line no-control-regex
const SGR_MOUSE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

let listening = false;
let suppressUntil = 0;
let wheelHandler: ((direction: 1 | -1) => void) | null = null;
let clickHandler: ((row: number, col: number) => void) | null = null;
let onData: ((chunk: Buffer) => void) | null = null;

/** Register a handler for left-click press events (1-indexed row/col). */
export function setMouseClickHandler(
  handler: ((row: number, col: number) => void) | null,
): void {
  clickHandler = handler;
}

/** True when `input` is a raw SGR mouse sequence that leaked into Ink. */
export function isMouseSequence(input: string): boolean {
  return input.startsWith('\x1b[<');
}

/** True briefly after any mouse event, to swallow split escape fragments. */
export function isSuppressedInput(): boolean {
  return Date.now() < suppressUntil;
}

/**
 * Enable wheel reporting. `handler` receives -1 for wheel up and +1 for
 * wheel down. Returns a cleanup function that disables reporting.
 */
export function enableMouseWheel(
  handler: (direction: 1 | -1) => void,
): () => void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return () => {};
  wheelHandler = handler;
  if (!listening) {
    listening = true;
    onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (!text.includes('\x1b[<')) return;
      suppressUntil = Date.now() + 120;
      SGR_MOUSE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = SGR_MOUSE.exec(text)) !== null) {
        const code = Number.parseInt(match[1] ?? '0', 10);
        const col = Number.parseInt(match[2] ?? '0', 10);
        const row = Number.parseInt(match[3] ?? '0', 10);
        const release = match[4] === 'm';
        if (code === 64) wheelHandler?.(-1);
        else if (code === 65) wheelHandler?.(1);
        // Left-button press (bits 0-1 = 0, bit 5 = motion excluded).
        else if (!release && (code & 3) === 0 && (code & 32) === 0) {
          clickHandler?.(row, col);
        }
      }
    };
    process.stdin.on('data', onData);
    process.stdout.write('\x1b[?1000h\x1b[?1006h');
  }
  return () => {
    wheelHandler = null;
    if (!listening) return;
    listening = false;
    if (onData) process.stdin.off('data', onData);
    onData = null;
    process.stdout.write('\x1b[?1000l\x1b[?1006l');
  };
}
