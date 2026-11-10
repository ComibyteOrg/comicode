import { stdin, stdout } from 'node:process';
import readline from 'node:readline';
import { bold, dim, danger, success } from './output.js';

export function isInteractive(): boolean {
  return Boolean(stdin.isTTY) && Boolean(stdout.isTTY);
}

export function requireInteractive(action: string): void {
  if (!isInteractive()) {
    throw new Error(
      `${action} requires an interactive terminal. Pass explicit flags for non-interactive use (see --help).`,
    );
  }
}

export interface TextPromptOptions {
  defaultValue?: string;
  required?: boolean;
  allowEmpty?: boolean;
  validate?: (value: string) => string | null;
}

function validateValue(value: string, options: TextPromptOptions): string | null {
  if (options.required && !value.trim()) return 'A value is required.';
  return options.validate?.(value) ?? null;
}

/** Prompt for a single line of text. */
export async function promptText(
  question: string,
  options: TextPromptOptions = {},
): Promise<string> {
  requireInteractive('This prompt');
  const suffix = options.defaultValue ? dim(` [${options.defaultValue}]`) : '';
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
  });
  try {
    for (;;) {
      const answer = await new Promise<string>((resolve) => {
        rl.question(`${bold('?')} ${question}${suffix} `, resolve);
      });
      const value = answer.trim() || options.defaultValue || '';
      if (!value && options.allowEmpty) return '';
      const error = validateValue(value, options);
      if (error) {
        stdout.write(`${danger('✖')} ${error}\n`);
        continue;
      }
      return value;
    }
  } finally {
    rl.close();
  }
}

/**
 * Prompt for a secret without echoing it. Input is read in raw mode and masked
 * with asterisks. Ctrl+C cancels the prompt without printing the secret.
 */
export async function promptSecret(question: string): Promise<string> {
  requireInteractive('Secret input');
  stdout.write(`${bold('?')} ${question} `);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode?.(true);
  stdin.resume();

  return new Promise<string>((resolve, reject) => {
    let value = '';
    let settled = false;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      stdin.removeListener('data', onData);
      stdin.setRawMode?.(wasRaw ?? false);
      stdin.pause();
      stdout.write('\n');
    };

    const finish = (): void => {
      cleanup();
      resolve(value);
    };

    const fail = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      for (const char of text) {
        if (char === '\u0003') {
          stdout.write(dim(' (cancelled)'));
          fail(new Error('Cancelled.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          finish();
          return;
        }
        if (char === '\u007f' || char === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }
        if (char === '\u001b') {
          // Ignore escape sequences from arrow keys.
          continue;
        }
        if (char >= ' ') {
          value += char;
          stdout.write('*');
        }
      }
    };

    stdin.on('data', onData);
  });
}

export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
}

/** Present a numbered list and return the selected value. */
export async function promptChoice<T>(
  question: string,
  choices: Choice<T>[],
  options: { defaultIndex?: number } = {},
): Promise<T> {
  requireInteractive('This prompt');
  if (choices.length === 0) throw new Error('No choices are available.');
  stdout.write(`\n${bold(question)}\n`);
  choices.forEach((choice, index) => {
    const marker =
      options.defaultIndex === index ? success('›') : dim(String(index + 1).padStart(2, ' '));
    const hint = choice.hint ? dim(`  ${choice.hint}`) : '';
    stdout.write(`  ${marker} ${choice.label}${hint}\n`);
  });
  for (;;) {
    const answer = await promptText(
      `Choose 1-${choices.length}${options.defaultIndex !== undefined ? ` (default ${options.defaultIndex + 1})` : ''}:`,
      {
        defaultValue:
          options.defaultIndex !== undefined ? String(options.defaultIndex + 1) : undefined,
        validate: (value) => {
          const index = Number(value);
          if (!Number.isInteger(index) || index < 1 || index > choices.length) {
            return `Enter a number between 1 and ${choices.length}.`;
          }
          return null;
        },
      },
    );
    const selected = choices[Number(answer) - 1];
    if (selected) return selected.value;
  }
}

/** Yes/no confirmation. Defaults to "no" unless specified. */
export async function promptConfirm(question: string, defaultValue = false): Promise<boolean> {
  requireInteractive('This confirmation');
  const hint = defaultValue ? 'Y/n' : 'y/N';
  for (;;) {
    const answer = await promptText(`${question} (${hint})`, { allowEmpty: true });
    const normalized = answer.trim().toLowerCase();
    if (!normalized) return defaultValue;
    if (['y', 'yes'].includes(normalized)) return true;
    if (['n', 'no'].includes(normalized)) return false;
    stdout.write(`${danger('✖')} Please answer yes or no.\n`);
  }
}

/** Ask for a list of values separated by commas. */
export async function promptList(
  question: string,
  options: TextPromptOptions = {},
): Promise<string[]> {
  const value = await promptText(question, options);
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Display a one-line success message used by interactive flows. */
export function printOk(message: string): void {
  stdout.write(`${success('✔')} ${message}\n`);
}

export function printInfo(message: string): void {
  stdout.write(`${dim('•')} ${message}\n`);
}

export function printError(message: string): void {
  stdout.write(`${danger('✖')} ${message}\n`);
}
