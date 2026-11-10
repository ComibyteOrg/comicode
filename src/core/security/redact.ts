const knownSecrets = new Set<string>();

/**
 * Register a secret value so it can be scrubbed from logs, error messages, and
 * diagnostic output. Only full values longer than 7 characters are tracked.
 */
export function registerSecret(value: string | null | undefined): void {
  if (!value || value.length < 8) return;
  knownSecrets.add(value);
  if (knownSecrets.size > 200) {
    const oldest = knownSecrets.values().next().value;
    if (oldest) knownSecrets.delete(oldest);
  }
}

export function clearRegisteredSecrets(): void {
  knownSecrets.clear();
}

const PATTERNS: Array<[RegExp, string]> = [
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED_GOOGLE_KEY]'],
  [/\b(sk-or-v1|sk-proj|sk-ant|sk)-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_API_KEY]'],
  [/\bgsk_[A-Za-z0-9]{20,}\b/g, '[REDACTED_GROQ_KEY]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED_SLACK_TOKEN]'],
  [/\b(Bearer|Token)\s+[A-Za-z0-9._~+/-]{16,}=*/gi, '$1 [REDACTED]'],
  [
    /("(?:api[_-]?key|apiKey|authorization|password|secret|token)"\s*:\s*")([^"]{8,})(")/gi,
    '$1[REDACTED]$3',
  ],
  [
    /((?:api[_-]?key|apiKey|authorization|password|secret|token)\s*[=:]\s*)([^\s,;"']{8,})/gi,
    '$1[REDACTED]',
  ],
];

/** Remove known secret values and common credential shapes from arbitrary text. */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let output = text;
  for (const secret of knownSecrets) {
    if (output.includes(secret)) {
      output = output.split(secret).join('[REDACTED]');
    }
  }
  for (const [pattern, replacement] of PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

/** Return a safe error message for display/logging. */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return redactSecrets(error.message);
  return redactSecrets(String(error));
}
