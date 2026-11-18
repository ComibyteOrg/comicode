/**
 * Local web dashboard server. Uses only Node built-ins so the CLI install
 * stays small. Talks to the real ComiCode engine through {@link DataProvider};
 * falls back to an in-memory demo provider when no store is supplied.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { Store } from '../db/store.js';
import type { TaskPlan, ToolCall } from '../types.js';
import type { AgentHooks, ConfirmDecision, TeamStageEvent } from '../agent/types.js';
import { CodingAgent, DEFAULT_AUTHORITY } from '../agent/agent.js';
import { VERSION } from '../../version.js';
import { InMemoryDataProvider } from './default-provider.js';
import type {
  DataProvider,
  ServerChatEvent,
  ServerChatHandlers,
  ServerStageEvent,
  ServerToolCall,
} from './types.js';

export interface StartServerOptions {
  port?: number;
  host?: string;
  open?: boolean;
  onLog?: (message: string) => void;
  /** Inject a custom provider (tests / embedding hosts). */
  dataProvider?: DataProvider;
  /** When supplied, the dashboard drives the real engine instead of demo data. */
  store?: Store;
  cwd?: string;
}

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

/** Bridges the real Store + CodingAgent to the web API contract. */
class EngineDataProvider implements DataProvider {
  private readonly approvals = new Map<string, (decision: ConfirmDecision) => void>();
  private approvalSeq = 0;

  constructor(
    private readonly store: Store,
    private readonly cwd: string,
  ) {}

  listProfiles() {
    return this.store.listProfiles();
  }

  listModels() {
    return this.store.listModels();
  }

  listTasks() {
    return this.store.listTasks({ limit: 100 });
  }

  getTask(id: string) {
    return this.store.getTask(id);
  }

  async approve(id: string, decision: 'allow' | 'always' | 'deny'): Promise<void> {
    const resolveApproval = this.approvals.get(id);
    if (resolveApproval) {
      this.approvals.delete(id);
      resolveApproval(decision);
    }
  }

  async sendPrompt(text: string, handlers: ServerChatHandlers): Promise<{ taskId: string | null }> {
    const profile =
      this.store.listProfiles().find((item) => item.id === this.store.getSelectedProfileId()) ??
      this.store.listProfiles().find((item) => item.enabled) ??
      null;
    if (!profile) {
      handlers.onError?.({ message: 'No provider connected. Run `comicode connect` first.' });
      return { taskId: null };
    }
    const task = this.store.createTask({
      projectPath: this.cwd,
      projectName: this.cwd.split(/[\\/]/).filter(Boolean).pop() ?? 'project',
      userRequest: text,
      taskType: 'coding',
      currentProfileId: profile.id,
      currentModelId: profile.defaultModel ?? null,
      metadata: { createdBy: 'web', source: 'comicode-web' },
    });
    handlers.onStatus?.({ state: 'running', label: 'Working', detail: task.id });

    const hooks: AgentHooks = {
      onText: (delta) => handlers.onText?.(delta),
      onPlan: (plan) => handlers.onPlan?.((plan as TaskPlan | null) ?? null),
      onStage: (stage: TeamStageEvent) => {
        const value: ServerStageEvent = {
          stage: stage.roleId,
          label: stage.label,
          department: stage.department,
          status: stage.status,
          index: stage.index,
          total: stage.total,
          model: stage.model ?? undefined,
          icon: stage.icon,
        };
        handlers.onStage?.(value);
      },
      onToolStart: (call: ToolCall) => {
        const value: ServerToolCall = {
          id: call.id ?? `call-${Date.now()}`,
          name: call.name,
          arguments: (call.arguments ?? {}) as Record<string, unknown>,
        };
        handlers.onToolStart?.(value);
      },
      onToolResult: (call, result) => {
        const value: ServerToolCall = {
          id: call.id ?? `call-${Date.now()}`,
          name: call.name,
          arguments: (call.arguments ?? {}) as Record<string, unknown>,
        };
        handlers.onToolResult?.(value, {
          ok: result.ok,
          content: result.content,
          changedFiles: result.changedFiles,
        });
      },
      onNotice: (message) => handlers.onStatus?.({ state: 'running', label: 'Notice', detail: message }),
      confirm: (request) => {
        const id = `approval-${++this.approvalSeq}`;
        handlers.onStatus?.({
          state: 'approval',
          label: request.title,
          detail: id,
        });
        return new Promise<ConfirmDecision>((resolveApproval) => {
          this.approvals.set(id, resolveApproval);
        });
      },
    };

    try {
      const agent = new CodingAgent({
        store: this.store,
        taskId: task.id,
        hooks,
        authority: { ...DEFAULT_AUTHORITY },
        settings: this.store.getSettings(),
        mode: 'team',
      });
      const result = await agent.run({ maxSteps: this.store.getSettings().agent.maxSteps });
      handlers.onStatus?.({ state: result.status, label: result.status, detail: task.id });
      handlers.onDone?.({
        status: result.status,
        summary: result.summary,
        taskId: task.id,
      });
      return { taskId: task.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      handlers.onError?.({ message });
      handlers.onDone?.({ status: 'failed', summary: null, taskId: task.id });
      return { taskId: task.id };
    }
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  response.end(body);
}

function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolveBody(body ? (JSON.parse(body) as Record<string, unknown>) : {});
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    request.on('error', reject);
  });
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('explorer', [url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Opening a browser is best-effort.
  }
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const port = options.port ?? 8787;
  const host = options.host ?? '127.0.0.1';
  const log = options.onLog ?? (() => {});
  const provider: DataProvider =
    options.dataProvider ??
    (options.store
      ? new EngineDataProvider(options.store, options.cwd ?? process.cwd())
      : new InMemoryDataProvider());
  const startedAt = Date.now();
  const eventClients = new Set<ServerResponse>();
  const root = repoRoot();
  const dist = resolve(root, 'web', 'dist');

  const broadcast = (event: ServerChatEvent): void => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of eventClients) {
      if (!client.destroyed) client.write(payload);
    }
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${host}:${port}`);
    const path = url.pathname;
    response.setHeader('Access-Control-Allow-Origin', '*');

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      response.end();
      return;
    }

    const jsonOrError = async (fn: () => Promise<unknown> | unknown): Promise<void> => {
      try {
        sendJson(response, 200, await fn());
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    };

    if (path === '/api/status' && request.method === 'GET') {
      void jsonOrError(async () => {
        const [profiles, models, tasks] = await Promise.all([
          provider.listProfiles(),
          provider.listModels(),
          provider.listTasks(),
        ]);
        return {
          version: VERSION,
          uptime: Math.floor((Date.now() - startedAt) / 1000),
          providers: profiles.length,
          models: models.length,
          activeTasks: tasks.filter((task) => task.status === 'running').length,
          mode: 'team',
          health: 'ok',
        };
      });
      return;
    }
    if (path === '/api/providers' && request.method === 'GET') {
      void jsonOrError(() => provider.listProfiles());
      return;
    }
    if (path === '/api/models' && request.method === 'GET') {
      void jsonOrError(() => provider.listModels());
      return;
    }
    if (path === '/api/tasks' && request.method === 'GET') {
      void jsonOrError(() => provider.listTasks());
      return;
    }
    if (path.startsWith('/api/tasks/') && request.method === 'GET') {
      const id = decodeURIComponent(path.slice('/api/tasks/'.length));
      void jsonOrError(async () => {
        const task = await provider.getTask(id);
        if (!task) {
          sendJson(response, 404, { error: 'Task not found.' });
          return null;
        }
        return task;
      });
      return;
    }
    if (path === '/api/approve' && request.method === 'POST') {
      void jsonOrError(async () => {
        const body = await readBody(request);
        await provider.approve(String(body.id ?? ''), (body.decision ?? 'allow') as 'allow' | 'always' | 'deny');
        return { ok: true };
      });
      return;
    }
    if (path === '/api/events' && request.method === 'GET') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      eventClients.add(response);
      request.on('close', () => eventClients.delete(response));
      response.write(`data: ${JSON.stringify({ type: 'status', state: 'connected' })}\n\n`);
      return;
    }
    if (path === '/api/chat' && request.method === 'POST') {
      void (async () => {
        try {
          const body = await readBody(request);
          const text = String(body.text ?? '').trim();
          if (!text) {
            sendJson(response, 400, { error: 'A prompt is required.' });
            return;
          }
          response.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          });
          const emit = (event: ServerChatEvent): void => {
            response.write(`data: ${JSON.stringify(event)}\n\n`);
            broadcast(event);
          };
          emit({ type: 'status', state: 'running', label: 'Starting' });
          const handlers: ServerChatHandlers = {
            onStatus: (status) => emit({ type: 'status', ...status }),
            onText: (delta) => emit({ type: 'text', delta }),
            onToolStart: (call) => emit({ type: 'tool', ...call, phase: 'start' }),
            onToolResult: (call, result) =>
              emit({ type: 'tool', id: call.id, name: call.name, phase: 'result', ok: result.ok, content: result.content }),
            onPlan: (plan) => emit({ type: 'plan', plan }),
            onStage: (stage) =>
              emit(typeof stage === 'string' ? { type: 'stage', stage } : { type: 'stage', ...stage }),
            onError: (error) => emit({ type: 'error', message: error.message }),
            onDone: (result) => emit({ type: 'done', ...result }),
          };
          await provider.sendPrompt(text, handlers);
        } catch (error) {
          response.write(
            `data: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) })}\n\n`,
          );
        } finally {
          if (!response.writableEnded) response.end();
        }
      })();
      return;
    }

    // Static frontend.
    if (request.method === 'GET' && !path.startsWith('/api/')) {
      const requested = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
      const candidate = resolve(dist, requested);
      if (candidate.startsWith(dist) && existsSync(candidate) && statSync(candidate).isFile()) {
        response.writeHead(200, {
          'Content-Type': MIME[extname(candidate).toLowerCase()] ?? 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
        });
        createReadStream(candidate).pipe(response);
        return;
      }
      const index = join(dist, 'index.html');
      if (existsSync(index)) {
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        createReadStream(index).pipe(response);
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(
        '<!doctype html><meta charset="utf-8"><title>ComiCode</title><body style="background:#0B0E14;color:#7CE8C3;font:16px ui-monospace,monospace;padding:48px">' +
          '<h1>ComiCode dashboard</h1><p>The API is live. Build the frontend from the project root with:</p><pre>npm run web:build</pre>' +
          '<p>or run <code>npm run web:dev</code> for hot reload.</p></body>',
      );
      return;
    }

    sendJson(response, 404, { error: 'Not found.' });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, host, () => resolveListen());
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://${host}:${actualPort}`;
  log(`ComiCode dashboard listening on ${url}`);
  if (options.open) openBrowser(url);

  return {
    port: actualPort,
    close: async () => {
      for (const client of eventClients) client.end();
      eventClients.clear();
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    },
  };
}
