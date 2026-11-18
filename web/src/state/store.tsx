import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, streamChat } from "../api/client";
import type {
  DoneEvent,
  ErrorEvent,
  ModelInfo,
  Plan,
  ProviderInfo,
  StatusResponse,
  Task,
  ToolEvent,
} from "../api/types";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  tools?: ToolEvent[];
}

export interface StageInfo {
  stage: string;
  label?: string;
  department?: string;
  status: "start" | "done" | "error";
  index?: number;
  total?: number;
  model?: string;
  icon?: string;
}

export interface StatusLine {
  state: string;
  label?: string;
  detail?: string;
}

export interface AppContextValue {
  ready: boolean;
  demo: boolean;
  status: StatusResponse | null;
  providers: ProviderInfo[];
  models: ModelInfo[];
  tasks: Task[];
  chat: ChatMessage[];
  stages: StageInfo[];
  plan: Plan | null;
  tools: ToolEvent[];
  statusLine: StatusLine;
  sending: boolean;
  error: string | null;
  send: (text: string) => void;
  setDemo: (value: boolean) => void;
  clearError: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

let idCounter = 0;
function uid(): string {
  idCounter += 1;
  return `id-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const demoPrompt =
  "Build a full feature: research, design, implement, secure, test, document and market it.";

const demoProviders: ProviderInfo[] = [
  { id: "prov-1", name: "Gemini personal", providerId: "gemini", enabled: true, defaultModel: "gemini-2.5-pro", quota: { used: 0.72, limit: 1 } },
  { id: "prov-2", name: "Groq free", providerId: "groq", enabled: true, defaultModel: "llama-3.3-70b", quota: { used: 0.18, limit: 1 } },
  { id: "prov-3", name: "OpenRouter free", providerId: "openrouter", enabled: true, defaultModel: "qwen-3-coder", quota: { used: 0.05, limit: 1 } },
];

const demoModels: ModelInfo[] = [
  { id: "m1", modelId: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", providerId: "gemini", profileId: "prov-1", access: "free", available: true },
  { id: "m2", modelId: "llama-3.3-70b", displayName: "Llama 3.3 70B", providerId: "groq", profileId: "prov-2", access: "free", available: true },
  { id: "m3", modelId: "qwen-3-coder", displayName: "Qwen 3 Coder", providerId: "openrouter", profileId: "prov-3", access: "free", available: true },
];

const demoTasks: Task[] = [
  {
    id: "task_demo_1",
    userRequest: "Build the quota-aware routing layer",
    status: "running",
    phase: "implement",
    summary: null,
    createdAt: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
  {
    id: "task_demo_2",
    userRequest: "Add multi-key failover",
    status: "done",
    phase: "done",
    summary: "Same model now rotates across all keys before other models.",
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
  },
];

const demoStages: Array<{ stage: string; label: string; department: string; icon: string }> = [
  { stage: "research", label: "Research", department: "Research & Discovery", icon: "◈" },
  { stage: "architecture", label: "Architecture", department: "Engineering / Architecture", icon: "◇" },
  { stage: "engineering", label: "Engineering", department: "Engineering / Delivery", icon: "⚙" },
  { stage: "security", label: "Security", department: "Security & Compliance", icon: "⬡" },
  { stage: "qa", label: "QA", department: "Quality Assurance", icon: "◉" },
  { stage: "review", label: "Review", department: "Engineering / Best Practice", icon: "✓" },
  { stage: "docs", label: "Docs", department: "Documentation", icon: "▤" },
];

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [demo, setDemoState] = useState<boolean>(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).has("demo") : false,
  );
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>(demoProviders);
  const [models, setModels] = useState<ModelInfo[]>(demoModels);
  const [tasks, setTasks] = useState<Task[]>(demoTasks);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [tools, setTools] = useState<ToolEvent[]>([]);
  const [statusLine, setStatusLine] = useState<StatusLine>({ state: "idle" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (demo) {
        setStatus({ version: "demo", uptime: 3600, mode: "team", health: { status: "ok" } });
        setReady(true);
        return;
      }
      try {
        const s = await api.status();
        if (cancelled) return;
        setStatus(s);
        await Promise.all([
          api.providers().then((p) => !cancelled && setProviders(p)).catch(() => undefined),
          api.models().then((m) => !cancelled && setModels(m)).catch(() => undefined),
          api.tasks().then((t) => !cancelled && setTasks(t)).catch(() => undefined),
        ]);
        setReady(true);
      } catch {
        if (!cancelled) setDemoState(true);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [demo]);

  const runDemoFlow = useCallback(async (assistantId: string, userText: string) => {
    setSending(true);
    setError(null);
    setPlan({
      summary: "Full organization pipeline for the request.",
      steps: [
        { title: "Research the codebase", status: "done" },
        { title: "Design the architecture", status: "running" },
        { title: "Implement with engineering", status: "pending" },
        { title: "Security + QA + review", status: "pending" },
        { title: "Docs + marketing", status: "pending" },
      ],
    });
    setStatusLine({ state: "running", label: "ComiCode Company working" });

    const fullText = [
      "The ComiCode Company is taking this end to end.",
      "",
      "**Research** mapped the existing code and constraints. **Architecture** chose the smallest safe design. **Engineering** is implementing it with the strongest free coding model available across your connected APIs.",
      "",
      "If a quota is hit, the same model is retried on your next key before anything else — then other free models in the same provider, then the next provider, with a compact handoff so no context is lost.",
      "",
      "Security, QA and review run as separate departments before anything is called done.",
    ].join("\n");

    for (let i = 0; i < demoStages.length; i += 1) {
      const def = demoStages[i]!;
      setStages((prev) => [
        ...prev.map((s) => (s.status === "start" ? { ...s, status: "done" as const } : s)),
        {
          stage: def.stage,
          label: def.label,
          department: def.department,
          status: "start",
          index: i + 1,
          total: demoStages.length,
          icon: def.icon,
          model: i % 2 === 0 ? "gemini-2.5-pro" : "llama-3.3-70b",
        },
      ]);
      const tokens = i === 2 ? fullText.split(/(\s+)/) : [];
      let acc = "";
      for (const tok of tokens) {
        acc += tok;
        setChat((c) => c.map((m) => (m.id === assistantId ? { ...m, content: acc } : m)));
        await sleep(14);
      }
      if (i === 2) {
        setTools((t) => [
          ...t,
          { type: "tool", id: uid(), name: "edit_file", arguments: JSON.stringify({ path: "src/feature.ts" }), phase: "result", ok: true, content: "src/feature.ts updated (+42 −8)" },
        ]);
      }
      await sleep(420);
    }
    setStages((prev) => prev.map((s) => ({ ...s, status: "done" as const })));
    setChat((c) => c.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)));
    setStatusLine({ state: "completed", label: "Task completed" });
    setSending(false);
    void userText;
  }, []);

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!demo || autoStarted.current) return;
    autoStarted.current = true;
    const timer = window.setTimeout(() => {
      const assistantId = uid();
      setChat([
        { id: uid(), role: "user", content: demoPrompt },
        { id: assistantId, role: "assistant", content: "", streaming: true },
      ]);
      void runDemoFlow(assistantId, demoPrompt);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [demo, runDemoFlow]);

  const send = useCallback(
    (rawText: string) => {
      const text = rawText.trim();
      if (!text) return;
      const assistantId = uid();
      setChat((c) => [
        ...c,
        { id: uid(), role: "user", content: text },
        { id: assistantId, role: "assistant", content: "", streaming: true },
      ]);
      setStatusLine({ state: "running" });
      setError(null);

      if (demo) {
        void runDemoFlow(assistantId, text);
        return;
      }

      setSending(true);
      void streamChat(
        { text },
        {
          onStatus: (event) =>
            setStatusLine({ state: event.state, label: event.label, detail: event.detail }),
          onText: (event) =>
            setChat((c) =>
              c.map((m) => (m.id === assistantId ? { ...m, content: m.content + event.delta } : m)),
            ),
          onTool: (event) => {
            setTools((t) => [...t, event]);
            setChat((c) =>
              c.map((m) =>
                m.id === assistantId ? { ...m, tools: [...(m.tools ?? []), event] } : m,
              ),
            );
          },
          onPlan: (event: import("../api/types").PlanEvent) => setPlan(event.plan),
          onStage: (event: import("../api/types").StageEvent) => {
            setStages((prev) => [
              ...prev.filter((s) => s.stage !== event.stage),
              {
                stage: event.stage,
                label: event.label,
                department: event.department,
                status: event.status,
                index: event.index,
                total: event.total,
                model: event.model,
                icon: event.icon,
              },
            ]);
          },
          onError: (event: ErrorEvent) => {
            setError(event.message);
            setStatusLine({ state: "error" });
            setSending(false);
            setChat((c) => c.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)));
          },
          onDone: (event: DoneEvent) => {
            setStatusLine({ state: event.status });
            setSending(false);
            setChat((c) => c.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)));
            if (event.taskId) {
              void api
                .task(event.taskId)
                .then((task) => setTasks((prev) => [task, ...prev.filter((t) => t.id !== task.id)]))
                .catch(() => undefined);
            }
          },
        },
      ).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        setStatusLine({ state: "error" });
        setSending(false);
        setChat((c) => c.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)));
      });
    },
    [demo, runDemoFlow],
  );

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<AppContextValue>(
    () => ({
      ready, demo, status, providers, models, tasks, chat, stages, plan, tools,
      statusLine, sending, error, send, setDemo: setDemoState, clearError,
    }),
    [ready, demo, status, providers, models, tasks, chat, stages, plan, tools, statusLine, sending, error, send, clearError],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
