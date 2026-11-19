/** Typed runtime events that drive the multi-agent workspace UI. */
export type AgentEventType =
  | 'agent.started'
  | 'agent.progress'
  | 'agent.handoff'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.waiting'
  | 'agent.needs_input'
  | 'task.created'
  | 'task.assigned'
  | 'task.completed'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed';

export interface AgentEvent {
  type: AgentEventType;
  taskId: string;
  agentId?: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export type NewAgentEvent = Omit<AgentEvent, 'timestamp'>;
