import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/core/events/bus.js';

describe('agent event bus', () => {
  it('delivers emitted events to subscribers with a timestamp', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.subscribe(listener);
    bus.emit({ type: 'agent.started', taskId: 't1', agentId: 'backend', payload: {} });
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0]!;
    expect(event.type).toBe('agent.started');
    expect(event.agentId).toBe('backend');
    expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
  });

  it('stops delivery after unsubscribe', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe(listener);
    unsubscribe();
    bus.emit({ type: 'agent.completed', taskId: 't1', payload: {} });
    expect(listener).not.toHaveBeenCalled();
  });

  it('bounds history to 500 events', () => {
    const bus = new EventBus({ maxHistory: 500 });
    for (let i = 0; i < 520; i += 1) {
      bus.emit({ type: 'agent.progress', taskId: 't1', payload: { n: i } });
    }
    const history = bus.history();
    expect(history).toHaveLength(500);
    expect(history[0]!.payload.n).toBe(20);
  });

  it('notifies onEmit and returns limited history', () => {
    const onEmit = vi.fn();
    const bus = new EventBus({ onEmit });
    bus.emit({ type: 'task.created', taskId: 't1', payload: {} });
    expect(onEmit).toHaveBeenCalledTimes(1);
    expect(bus.history(1)).toHaveLength(1);
  });
});
