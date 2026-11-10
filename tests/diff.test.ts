import { describe, expect, it } from 'vitest';
import { applyUnifiedPatch, countDelta, createUnifiedDiff } from '../src/core/safety/diff.js';

describe('unified diff generation', () => {
  it('returns an empty string for identical content', () => {
    expect(createUnifiedDiff('a.ts', 'same\n', 'same\n')).toBe('');
  });

  it('renders headers, a hunk, and changed lines', () => {
    const before = 'one\ntwo\nthree\nfour\nfive\n';
    const after = 'one\ntwo\nTHREE\nfour\nfive\n';
    const diff = createUnifiedDiff('src/file.ts', before, after);
    expect(diff).toContain('--- a/src/file.ts');
    expect(diff).toContain('+++ b/src/file.ts');
    expect(diff).toContain('@@');
    expect(diff).toContain('-three');
    expect(diff).toContain('+THREE');
    expect(diff).toContain(' two');
    expect(diff).toContain(' four');
  });

  it('groups distant changes into separate hunks', () => {
    const before = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n') + '\n';
    const after = before
      .replace('line 2\n', 'line two\n')
      .replace('line 28\n', 'line twenty-eight\n');
    const diff = createUnifiedDiff('file.txt', before, after);
    expect(diff.match(/^@@/gm)).toHaveLength(2);
  });

  it('summarizes large files instead of building an expensive table', () => {
    const before = Array.from({ length: 2100 }, (_, index) => `a${index}`).join('\n');
    const after = Array.from({ length: 2100 }, (_, index) => `b${index}`).join('\n');
    const diff = createUnifiedDiff('huge.txt', before, after);
    expect(diff).toContain('large file changed');
    expect(diff).toContain('lines: 2100 -> 2100');
  });

  it('counts line deltas', () => {
    expect(countDelta('a\nb\n', 'a\nb\nc\n')).toBe('lines: 3 -> 4');
  });
});

describe('unified patch application', () => {
  const before = 'alpha\nbeta\ngamma\ndelta\nepsilon\n';

  it('applies a hunk and preserves surrounding context', () => {
    const patch = [
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -2,3 +2,3 @@',
      ' beta',
      '-gamma',
      '+GAMMA',
      ' delta',
      '',
    ].join('\n');
    expect(applyUnifiedPatch(before, patch)).toBe('alpha\nbeta\nGAMMA\ndelta\nepsilon\n');
  });

  it('applies multiple ordered hunks', () => {
    const patch = [
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1,1 +1,1 @@',
      '-alpha',
      '+ALPHA',
      '@@ -4,1 +4,1 @@',
      '-delta',
      '+DELTA',
      '',
    ].join('\n');
    expect(applyUnifiedPatch(before, patch)).toBe('ALPHA\nbeta\ngamma\nDELTA\nepsilon\n');
  });

  it('preserves a missing trailing newline', () => {
    const patch = ['@@ -1,1 +1,1 @@', '-a', '+b'].join('\n');
    expect(applyUnifiedPatch('a', patch)).toBe('b');
  });

  it('supports inserting and removing lines', () => {
    const patch = ['@@ -1,3 +1,4 @@', ' alpha', ' beta', '+inserted', ' gamma', ''].join('\n');
    expect(applyUnifiedPatch(before, patch)).toBe('alpha\nbeta\ninserted\ngamma\ndelta\nepsilon\n');
  });

  it('fails strictly on context mismatch without partial output', () => {
    const patch = ['@@ -2,1 +2,1 @@', '-wrong', '+beta2'].join('\n');
    expect(() => applyUnifiedPatch(before, patch)).toThrow(/Patch removal mismatch at line 2/);
  });

  it('rejects patches with no hunks or overlapping hunks', () => {
    expect(() => applyUnifiedPatch(before, 'no hunk here')).toThrow(/No unified diff hunks/);
    const overlapping = [
      '@@ -1,2 +1,3 @@',
      '-alpha',
      '+ALPHA',
      ' beta',
      '@@ -2,1 +2,1 @@',
      '-beta',
      '+BETA',
      '',
    ].join('\n');
    expect(() => applyUnifiedPatch(before, overlapping)).toThrow(/overlap|out of order/);
  });

  it('round-trips a generated diff', () => {
    const after = 'alpha\nbeta\ngamma\ndelta\nzeta\n';
    const diff = createUnifiedDiff('file.txt', before, after);
    expect(applyUnifiedPatch(before, diff)).toBe(after);
  });
});
