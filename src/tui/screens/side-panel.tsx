import React from 'react';
import { Box, Text } from 'ink';
import type { TaskPlan } from '../../core/types.js';
import type { AgentMode } from '../../core/agent/modes.js';
import type { TeamStageEvent } from '../../core/agent/types.js';
import { formatCount } from '../components.js';
import { glyph, theme } from '../theme.js';

export interface SidePanelProps {
  stages: TeamStageEvent[];
  plan: TaskPlan | null;
  route: string | null;
  usage: { inputTokens: number; outputTokens: number };
  agentMode: AgentMode;
}

/** Collapsible right-hand pane showing the active team, todos and route. */
export function SidePanel({
  stages,
  plan,
  route,
  usage,
  agentMode,
}: SidePanelProps): React.ReactElement {
  const done = stages.filter((stage) => stage.status === 'done').length;
  return (
    <Box
      width={26}
      flexDirection="column"
      flexShrink={0}
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      overflow="hidden"
    >
      <Text color={theme.accent} bold>
        {glyph.brand} TEAMS
      </Text>
      <Text color={theme.faint} dimColor>
        {agentMode} · {done}/{stages.length || 0} done
      </Text>
      <Box marginTop={1} flexDirection="column">
        {stages.length === 0 ? (
          <Text color={theme.faint} dimColor wrap="truncate">
            No active team
          </Text>
        ) : (
          stages.slice(-8).map((stage) => (
            <Text
              key={`${stage.index}-${stage.roleId}`}
              color={
                stage.status === 'done'
                  ? theme.success
                  : stage.status === 'error'
                    ? theme.danger
                    : stage.status === 'start'
                      ? theme.accent
                      : theme.faint
              }
              wrap="truncate"
            >
              {stage.status === 'done' ? '✓' : stage.status === 'error' ? '✗' : stage.status === 'start' ? '▸' : '·'}{' '}
              {stage.label}
            </Text>
          ))
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color={theme.violet} bold>
          ▤ PLAN
        </Text>
        {plan?.steps?.length ? (
          plan.steps.slice(0, 6).map((step, index) => (
            <Text key={`${index}-${step.title}`} color={theme.muted} wrap="truncate">
              {step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '◉' : '○'} {step.title}
            </Text>
          ))
        ) : (
          <Text color={theme.faint} dimColor>
            No plan yet
          </Text>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color={theme.faint} wrap="truncate">
          {glyph.route} {route ?? 'unrouted'}
        </Text>
        <Text color={theme.muted}>
          {formatCount(usage.inputTokens)} in / {formatCount(usage.outputTokens)} out
        </Text>
        <Text color={theme.faint} dimColor>
          f6 toggle
        </Text>
      </Box>
    </Box>
  );
}
