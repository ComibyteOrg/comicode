/**
 * ComiCode CLI entry point.
 *
 * `node:sqlite` still emits an ExperimentalWarning on current Node releases. It
 * is harmless but noisy for a polished CLI, so we filter just that one warning
 * before any module can load the database, then import the real entry point.
 */
const originalEmitWarning = process.emitWarning.bind(process);

process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const first = rest[0];
  const type =
    typeof first === 'string'
      ? first
      : first && typeof first === 'object' && 'type' in first
        ? String((first as { type?: unknown }).type ?? '')
        : '';
  const message = typeof warning === 'string' ? warning : warning.message;
  if (type === 'ExperimentalWarning' && /sqlite/i.test(message)) return;
  return (originalEmitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(`comicode: ${message}`);
  if (process.env.COMICODE_DEBUG && reason instanceof Error && reason.stack) {
    console.error(reason.stack);
  }
  process.exitCode = 1;
});

// Windows terminals can close mid-write when the user quits a pager or TUI.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

await import('./main.js').then((module) => module.main());

export {};
