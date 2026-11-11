import { z } from 'zod';
import type { AccessClassification } from './types.js';

export const ACCESS_CLASSIFICATIONS: AccessClassification[] = [
  'free-confirmed',
  'free-tier',
  'paid',
  'user-free',
  'user-paid',
  'unknown',
  'unavailable',
];

export const AccessClassificationSchema = z.enum([
  'free-confirmed',
  'free-tier',
  'paid',
  'user-free',
  'user-paid',
  'unknown',
  'unavailable',
]);

export const RoutingPolicySchema = z.object({
  /** Prefer models classified as free when choosing a fallback. */
  preferFree: z.boolean().default(true),
  /** Try other profiles of the same provider before moving to another provider. */
  preferSameProvider: z.boolean().default(true),
  /** Bias selection toward models with stronger coding metadata. */
  preferCoding: z.boolean().default(true),
  /** Allow fallback to models classified as paid. Explicit selections are still honored. */
  allowPaid: z.boolean().default(false),
  /** Allow fallback to models with unknown pricing/access. */
  allowUnknownAccess: z.boolean().default(true),
  /** Maximum fallback candidates considered per routing pass. */
  maxFallbacks: z.number().int().min(1).max(20).default(4),
  /** Maximum retry attempts against a single candidate (excluding retry-after waits). */
  maxRetriesPerCandidate: z.number().int().min(0).max(5).default(1),
  /** Base delay for exponential backoff, in milliseconds. */
  retryBaseDelayMs: z.number().int().min(100).max(60_000).default(1000),
  /** Maximum backoff delay, in milliseconds. */
  retryMaxDelayMs: z.number().int().min(100).max(300_000).default(30_000),
  /** Provider IDs to prefer, in order. */
  preferredProviders: z.array(z.string()).default([]),
  /** Provider IDs that must never be selected. */
  excludedProviders: z.array(z.string()).default([]),
  /** Minimum context window required for fallback models. */
  minContextWindow: z.number().int().min(0).default(0),
});

export const AgentSettingsSchema = z.object({
  maxSteps: z.number().int().min(1).max(200).default(30),
  /** Fraction of the model context window that may be used for prompt context. */
  contextBudgetRatio: z.number().min(0.2).max(0.9).default(0.45),
  maxToolOutputChars: z.number().int().min(1000).max(200_000).default(12_000),
  autoApproveReadOnly: z.boolean().default(true),
  autoApproveFileEdits: z.boolean().default(false),
  autoApproveCommands: z.boolean().default(false),
  allowSecretAccess: z.boolean().default(false),
  /**
   * How the agent asks for approval:
   * - `ask`: prompt for every sensitive action (per-action "always allow" grants still apply).
   * - `trusted`: auto-approve file edits and normal commands; still ask for dangerous commands and secrets.
   * - `auto`: never prompt; only hard safety blocks apply.
   */
  permissionMode: z.enum(['ask', 'trusted', 'auto']).default('ask'),
  /**
   * Persistent "always allow" grants chosen in approval dialogs.
   * Commands match exactly or by trailing `*` prefix; paths are
   * project-relative and also match everything beneath them.
   */
  permissions: z
    .object({
      allowCommands: z.array(z.string()).default([]),
      allowPaths: z.array(z.string()).default([]),
    })
    .prefault({}),
  testCommand: z.string().nullable().default(null),
  lintCommand: z.string().nullable().default(null),
  buildCommand: z.string().nullable().default(null),
  /** Optional command that visually verifies UI work (e.g. a screenshot/a11y script). */
  uiVerifyCommand: z.string().nullable().default(null),
  collaboration: z
    .object({
      enabled: z.boolean().default(false),
      plannerProfileId: z.string().nullable().default(null),
      reviewerProfileId: z.string().nullable().default(null),
      testerProfileId: z.string().nullable().default(null),
      reviewChanges: z.boolean().default(true),
    })
    .prefault({}),
});

export const SettingsSchema = z.object({
  theme: z.enum(['dark', 'dark-dim']).default('dark'),
  accent: z.enum(['cyan', 'blue', 'green', 'magenta', 'orange']).default('cyan'),
  ui: z
    .object({
      /** Shortcut id to binding string, for example { model: "ctrl+g" }. */
      shortcuts: z.record(z.string(), z.string()).default({}),
      /** Color theme name — see THEMES in src/tui/theme.ts. */
      theme: z.string().default('obsidian'),
      /**
       * Mouse reporting for wheel-scroll/click. Off by default: mouse capture
       * prevents the terminal's native highlight/copy, and keyboard scrolling
       * (pgup/pgdn, ctrl+↑/↓) always works. Enable it in settings if wheel
       * scrolling matters more — then use Shift+drag or ctrl+y to copy.
       */
      mouseScroll: z.boolean().default(true),
    })
    .prefault({}),
  routing: RoutingPolicySchema.prefault({}),
  agent: AgentSettingsSchema.prefault({}),
  privacy: z
    .object({
      /** ComiCode sends no telemetry. This field documents the guarantee. */
      telemetry: z.literal(false).default(false),
    })
    .prefault({}),
  storage: z
    .object({
      /** Days to keep completed/failed tasks before /cleanup removes them. */
      retentionDays: z.number().int().min(1).max(3650).default(30),
    })
    .prefault({}),
});

export type AppSettings = z.infer<typeof SettingsSchema>;
export type RoutingPolicy = z.infer<typeof RoutingPolicySchema>;
export type AgentSettings = z.infer<typeof AgentSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = SettingsSchema.parse({});

/** Deep merge persisted settings with defaults, dropping unknown keys via Zod. */
export function parseSettings(raw: unknown): AppSettings {
  const merged = deepMerge(DEFAULT_SETTINGS as unknown as Record<string, unknown>, raw);
  return SettingsSchema.parse(merged);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepMerge<T extends Record<string, unknown>>(base: T, override: unknown): T {
  if (!isRecord(override)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isRecord(value) && isRecord(out[key])) {
      out[key] = deepMerge(out[key] as Record<string, unknown>, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

export const SETTING_PATHS = [
  'routing.preferFree',
  'routing.preferSameProvider',
  'routing.preferCoding',
  'routing.allowPaid',
  'routing.allowUnknownAccess',
  'routing.maxFallbacks',
  'routing.maxRetriesPerCandidate',
  'routing.retryBaseDelayMs',
  'routing.retryMaxDelayMs',
  'routing.minContextWindow',
  'routing.preferredProviders',
  'routing.excludedProviders',
  'agent.maxSteps',
  'agent.contextBudgetRatio',
  'agent.maxToolOutputChars',
  'agent.autoApproveReadOnly',
  'agent.autoApproveFileEdits',
  'agent.autoApproveCommands',
  'agent.allowSecretAccess',
  'agent.permissionMode',
  'agent.permissions.allowCommands',
  'agent.permissions.allowPaths',
  'storage.retentionDays',
  'agent.testCommand',
  'agent.lintCommand',
  'agent.buildCommand',
  'agent.uiVerifyCommand',
  'agent.collaboration.enabled',
  'agent.collaboration.plannerProfileId',
  'agent.collaboration.reviewerProfileId',
  'agent.collaboration.testerProfileId',
  'agent.collaboration.reviewChanges',
  'theme',
  'accent',
  'ui.mouseScroll',
] as const;
