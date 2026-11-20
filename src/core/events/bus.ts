import type { AgentEvent, NewAgentEvent } from './types.js';

export interface EventBusOptions {
  maxHistory?: number;
  onEmit?: (event: AgentEvent) => void;
}

/** In-process, bounded event bus. Listeners are notified synchronously. */
export class EventBus {
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private readonly events: AgentEvent[] = [];
  private readonly maxHistory: number;

  constructor(private readonly options: EventBusOptions = {}) {
    this.maxHistory = Math.max(1, options.maxHistory ?? 500);
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(input: NewAgentEvent): AgentEvent {
    const event: AgentEvent = { ...input, timestamp: new Date().toISOString() };
    this.events.push(event);
    if (this.events.length > this.maxHistory) {
      this.events.splice(0, this.events.length - this.maxHistory);
    }
    for (const listener of this.listeners) listener(event);
    this.options.onEmit?.(event);
    return event;
  }

  history(limit?: number): AgentEvent[] {
    const size = Math.max(0, Math.min(this.events.length, limit ?? this.events.length));
    return size === this.events.length ? [...this.events] : this.events.slice(-size);
  }

  clear(): void {
    this.events.length = 0;
  }
}
