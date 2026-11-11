import { performance } from 'node:perf_hooks';
import { statSync } from 'node:fs';
import { openAppContext, type AppContext } from './app.js';
import { ContextBuilder, estimateTokens, type ContextBuildInput } from './agent/context.js';
import { loadSkills } from './agent/skills.js';
import { ProjectInspector } from './project/inspector.js';
import { DEFAULT_SETTINGS } from './settings.js';
import type { AgentMessage, ModelInfo, TaskRecord } from './types.js';

export interface BenchResult {
  metric: string;
  value: number;
  unit: string;
}

function mb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

const BENCH_MODEL: ModelInfo = {
  id: 'bench',
  providerId: 'custom',
  profileId: null,
  modelId: 'bench-model',
  displayName: 'bench',
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
  supportsTools: true,
  supportsStreaming: true,
  supportsVision: false,
  codingSuitability: 5,
  reasoningSuitability: 5,
  inputPricePerMillion: null,
  outputPricePerMillion: null,
  access: 'unknown',
  accessSource: 'bench',
  accessNotes: null,
  available: true,
  lastCheckedAt: null,
  userClassification: null,
  metadata: {},
};

const BENCH_TASK = {
  id: 'bench',
  projectPath: '',
  projectName: 'bench',
  userRequest: 'Implement a benchmark harness for the agent context engine.',
  taskType: 'coding',
  status: 'active',
  phase: 'inspect',
  plan: null,
  completedSteps: [],
  pendingSteps: [],
  relevantFiles: [],
  changedFiles: [],
  currentProfileId: null,
  currentModelId: null,
  attempts: [],
  metadata: {},
  summary: null,
  error: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  completedAt: null,
  resumeCount: 0,
  lastCheckpointId: null,
} as unknown as TaskRecord;

/**
 * Honest micro-benchmarks for the hot paths ComiCode controls:
 * context open, project inspection, skill loading, and context assembly.
 * Measures wall time and process memory — no extrapolated claims.
 */
export async function runBenchmarks(cwd: string, iterations = 5): Promise<BenchResult[]> {
  const results: BenchResult[] = [];
  const time = async (label: string, fn: () => void | Promise<void>): Promise<void> => {
    await fn(); // warmup
    const samples: number[] = [];
    for (let i = 0; i < iterations; i += 1) {
      const start = performance.now();
      await fn();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    results.push({
      metric: label,
      value: Math.round((samples[Math.floor(samples.length / 2)] ?? 0) * 100) / 100,
      unit: 'ms',
    });
  };

  // 1. Startup: open the app context (store + settings) — the TUI's heaviest init.
  let context: AppContext | null = null;
  await time('startup.openContext', () => {
    context?.close();
    context = openAppContext(cwd);
  });

  // 2. Memory after context open + on-disk storage footprint.
  const opened = context as AppContext | null;
  if (opened) {
    const mem = process.memoryUsage();
    results.push({ metric: 'memory.heapAfterOpen', value: mb(mem.heapUsed), unit: 'MB' });
    results.push({ metric: 'memory.rssAfterOpen', value: mb(mem.rss), unit: 'MB' });
    try {
      results.push({
        metric: 'storage.databaseSize',
        value: mb(statSync(opened.store.path).size),
        unit: 'MB',
      });
    } catch {
      // In-memory or missing db — skip rather than fabricate.
    }
  }

  // 3. Project inspection (file listing used by every task).
  const inspector = new ProjectInspector(cwd);
  await time('inspect.project', async () => {
    await inspector.snapshot();
  });

  // 4. Skill discovery + indexing.
  await time('skills.load', () => {
    loadSkills(cwd);
  });

  // 5. Context assembly for a representative coding task.
  const skills = loadSkills(cwd);
  const history: AgentMessage[] = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Sample message ${i} with some representative content about the codebase.`,
  }));
  const builder = new ContextBuilder();
  const input: ContextBuildInput = {
    task: { ...BENCH_TASK, projectPath: cwd } as TaskRecord,
    model: BENCH_MODEL,
    history,
    settings: DEFAULT_SETTINGS,
    inspector,
    relevantFiles: [],
    cache: {},
    skills,
    mode: 'build',
  };
  await time('context.build', () => {
    builder.build(input);
  });

  const built = builder.build(input);
  results.push({
    metric: 'context.estimatedTokens',
    value: estimateTokens(built.system + built.contextText),
    unit: 'tokens',
  });

  (context as AppContext | null)?.close();
  return results;
}
