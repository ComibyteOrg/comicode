import React from 'react';
import { Box, Text } from 'ink';
import type { AgentDefinition, AgentRuntimeState } from '../../core/agent/registry.js';
import type { TaskContract } from '../../core/agent/task-contract.js';
import type { AgentEvent } from '../../core/events/types.js';
import { redactSecrets } from '../../core/security/redact.js';
import { theme } from '../theme.js';

function safe(value: string): string {
  return redactSecrets(value.replace(/\b(?:sk|ghp|gho|glpat|AIza)[A-Za-z0-9_-]{8,}/gi, '[redacted]'));
}

const STATUS_COLOR: Record<AgentRuntimeState['status'], string> = {
  idle: theme.faint,
  working: theme.accent,
  waiting: theme.violet,
  completed: theme.success,
  failed: theme.danger,
  needs_input: theme.warning,
};

export function AgentInspector({
  definition,
  state,
  recentEvents,
}: {
  definition: AgentDefinition;
  state: AgentRuntimeState;
  recentEvents: AgentEvent[];
}): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.borderStrong} paddingX={1}>
      <Text color={theme.accent} bold>
        {definition.icon} {definition.name}
      </Text>
      <Text color={theme.muted}>{definition.description}</Text>
      <Text color={STATUS_COLOR[state.status]}>
        status {state.status} · assigned {state.assignedTaskCount} · completed {state.completedTaskCount}
      </Text>
      <Text color={theme.faint}>
        mode {definition.mode ?? 'coordinator'} · tools {definition.toolScope}
      </Text>
      <Text color={theme.faint}>
        model {state.model ?? 'automatic'} · provider {state.provider ?? 'automatic'}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {definition.responsibilities.map((item) => (
          <Text key={item} color={theme.muted}>
            · {safe(item)}
          </Text>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {recentEvents.slice(-5).map((event, index) => (
          <Text key={`${event.timestamp}-${index}`} color={theme.faint} wrap="truncate">
            {event.type} {safe(String(event.payload.note ?? ''))}
          </Text>
        ))}
      </Box>
      {state.lastError ? (
        <Text color={theme.danger}>last error: {safe(state.lastError)}</Text>
      ) : null}
    </Box>
  );
}

export function TaskBoard({ contracts }: { contracts: TaskContract[] }): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      <Text color={theme.accent} bold>
        ▤ TASK BOARD
      </Text>
      {contracts.map((contract) => (
        <Box key={contract.id} flexDirection="column" marginBottom={1}>
          <Text color={theme.text} wrap="truncate">
            {contract.id} · {contract.assignee}
          </Text>
          <Text color={theme.muted} wrap="truncate">
            {contract.status} · priority {contract.priority} · deps {contract.dependencies.join(',') || 'none'}
          </Text>
          {contract.actualResult ? (
            <Text color={theme.faint} wrap="truncate">
              {contract.actualResult.slice(0, 120)}
            </Text>
          ) : null}
        </Box>
      ))}
      {contracts.length === 0 ? (
        <Text color={theme.faint}>No tasks yet.</Text>
      ) : null}
    </Box>
  );
}
