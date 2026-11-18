import type {
  ChatEvent,
  DoneEvent,
  ErrorEvent,
  ModelInfo,
  PlanEvent,
  ProviderInfo,
  StageEvent,
  StatusEvent,
  StatusResponse,
  Task,
  TextEvent,
  ToolEvent,
} from "./types";

async function request<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`ComiCode API error: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const api = {
  status: (): Promise<StatusResponse> => request<StatusResponse>("/api/status"),
  providers: (): Promise<ProviderInfo[]> => request<ProviderInfo[]>("/api/providers"),
  models: (): Promise<ModelInfo[]> => request<ModelInfo[]>("/api/models"),
  tasks: (): Promise<Task[]> => request<Task[]>("/api/tasks"),
  task: (id: string): Promise<Task> => request<Task>(`/api/tasks/${id}`),
};

export interface ChatHandlers {
  onStatus?: (event: StatusEvent) => void;
  onText?: (event: TextEvent) => void;
  onTool?: (event: ToolEvent) => void;
  onPlan?: (event: PlanEvent) => void;
  onStage?: (event: StageEvent) => void;
  onError?: (event: ErrorEvent) => void;
  onDone?: (event: DoneEvent) => void;
}

export async function streamChat(
  body: { text: string; taskId?: string },
  handlers: ChatHandlers,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Chat stream failed: HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      // keep fallback message
    }
    throw new Error(message);
  }
  if (!res.body) {
    throw new Error("Streaming response body unavailable");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let settled = false;

  const dispatch = (raw: string) => {
    const blocks = raw.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload) continue;
      try {
        const event = JSON.parse(payload) as ChatEvent;
        switch (event.type) {
          case "status":
            handlers.onStatus?.(event);
            break;
          case "text":
            handlers.onText?.(event);
            break;
          case "tool":
            handlers.onTool?.(event);
            break;
          case "plan":
            handlers.onPlan?.(event);
            break;
          case "stage":
            handlers.onStage?.(event);
            break;
          case "error":
            handlers.onError?.(event);
            break;
          case "done":
            handlers.onDone?.(event);
            break;
        }
      } catch {
        // malformed keep-alive / partial event — skip
      }
    }
  };

  while (!settled) {
    const { done, value } = await reader.read();
    if (done) {
      settled = true;
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    dispatch(buffer);
  }
  buffer += decoder.decode();
  if (buffer.trim().length > 0) {
    dispatch(buffer);
  }
}
