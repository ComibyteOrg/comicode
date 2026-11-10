/**
 * Split text into logical lines without inventing a trailing empty line for
 * newline-terminated files. `applyUnifiedPatch` re-adds the terminator.
 */
function splitDiffLines(text: string): string[] {
  if (text === '') return [''];
  const lines = text.split(/\r?\n/);
  if (text.endsWith('\n')) lines.pop();
  return lines;
}

/** Produce a unified diff between two text buffers for UI display. */
export function createUnifiedDiff(
  filePath: string,
  before: string,
  after: string,
  contextLines = 3,
): string {
  if (before === after) return '';
  const a = splitDiffLines(before);
  const b = splitDiffLines(after);

  // Guard the O(n*m) LCS table for very large files.
  if (a.length * b.length > 4_000_000) {
    return [
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      `@@ large file changed: ${a.length} -> ${b.length} lines @@`,
      `${countDelta(before, after)}`,
    ].join('\n');
  }

  // Classic LCS table.
  const n = a.length;
  const m = b.length;
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] =
        a[i] === b[j]
          ? (table[i + 1]![j + 1] ?? 0) + 1
          : Math.max(table[i + 1]![j] ?? 0, table[i]![j + 1] ?? 0);
    }
  }

  type Op = { type: ' ' | '-' | '+'; text: string; aLine: number; bLine: number };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: ' ', text: a[i] ?? '', aLine: i + 1, bLine: j + 1 });
      i += 1;
      j += 1;
    } else if ((table[i + 1]![j] ?? 0) >= (table[i]![j + 1] ?? 0)) {
      ops.push({ type: '-', text: a[i] ?? '', aLine: i + 1, bLine: j + 1 });
      i += 1;
    } else {
      ops.push({ type: '+', text: b[j] ?? '', aLine: i + 1, bLine: j + 1 });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: '-', text: a[i] ?? '', aLine: i + 1, bLine: j + 1 });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: '+', text: b[j] ?? '', aLine: i + 1, bLine: j + 1 });
    j += 1;
  }

  const changedIndexes = ops
    .map((op, index) => (op.type !== ' ' ? index : -1))
    .filter((index) => index >= 0);
  if (changedIndexes.length === 0) return '';

  const ranges: Array<{ start: number; end: number }> = [];
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

  const lines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  for (const range of ranges) {
    const slice = ops.slice(range.start, range.end + 1);
    const first = slice[0]!;
    const aStart = first.type === '+' ? first.aLine - 1 : first.aLine;
    const bStart = first.type === '-' ? first.bLine - 1 : first.bLine;
    const aCount = slice.filter((op) => op.type !== '+').length;
    const bCount = slice.filter((op) => op.type !== '-').length;
    lines.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const op of slice) {
      lines.push(`${op.type}${op.text}`);
    }
  }
  return lines.join('\n');
}

export function countDelta(before: string, after: string): string {
  const beforeLines = before ? before.split(/\r?\n/).length : 0;
  const afterLines = after ? after.split(/\r?\n/).length : 0;
  return `lines: ${beforeLines} -> ${afterLines}`;
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

function parseHunks(patch: string): Hunk[] {
  const lines = patch.split(/\r?\n/);
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  for (const line of lines) {
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('diff ')) continue;
    const header = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(line);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
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

/**
 * Apply a standard unified diff (`@@ -a,b +c,d @@`) to text. Returns the new
 * content or throws with a clear reason. Deliberately strict: failed context
 * means no partial file is written.
 */
export function applyUnifiedPatch(before: string, patch: string): string {
  const hunks = parseHunks(patch);
  if (hunks.length === 0) {
    throw new Error('No unified diff hunks found. Use ---/+++ and @@ headers, or use edit_file.');
  }
  const trailingNewline = before.endsWith('\n');
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const source = before.split(/\r?\n/);
  if (trailingNewline) source.pop();
  const output: string[] = [];
  let cursor = 0;

  for (const hunk of hunks) {
    const target = Math.max(0, hunk.oldStart - 1);
    if (target < cursor) {
      throw new Error('Patch hunks overlap or are out of order.');
    }
    while (cursor < target && cursor < source.length) {
      output.push(source[cursor]!);
      cursor += 1;
    }
    for (const line of hunk.lines) {
      const marker = line[0];
      const text = line.slice(1);
      if (marker === ' ') {
        if (source[cursor] !== text) {
          throw new Error(
            `Patch context mismatch at line ${cursor + 1}: expected "${text}", found "${source[cursor] ?? '<EOF>'}".`,
          );
        }
        output.push(text);
        cursor += 1;
      } else if (marker === '-') {
        if (source[cursor] !== text) {
          throw new Error(
            `Patch removal mismatch at line ${cursor + 1}: expected "${text}", found "${source[cursor] ?? '<EOF>'}".`,
          );
        }
        cursor += 1;
      } else if (marker === '+') {
        output.push(text);
      } else if (marker === '\\') {
        // "\ No newline at end of file" marker: ignore.
        continue;
      }
    }
  }
  while (cursor < source.length) {
    output.push(source[cursor]!);
    cursor += 1;
  }
  return output.join(eol) + (trailingNewline ? eol : '');
}
