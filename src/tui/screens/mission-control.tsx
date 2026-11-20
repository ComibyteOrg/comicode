import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AppContext } from '../../core/app.js';
import type { AgentMode } from '../../core/agent/modes.js';
import {
  AGENT_REGISTRY,
  deriveAgentStates,
  getAgentDefinition,
  type AgentId,
} from '../../core/agent/registry.js';
import type { EventBus } from '../../core/events/bus.js';
import type { AgentEvent } from '../../core/events/types.js';
import type { ResumeRequest } from './workspace.js';
import { useLayout } from '../components.js';
import { glyph, theme } from '../theme.js';
import { Workspace } from './workspace.js';
import { AgentInspector, TaskBoard } from './agent-views.js';
import type { TaskContract } from '../../core/agent/task-contract.js';

export interface MissionControlProps {
  context: AppContext;
  active: boolean;
  eventBus: EventBus;
  agentMode: AgentMode;
  onAgentMode: (mode: AgentMode) => void;
  resumeRequest?: ResumeRequest | null;
  selectionMode?: boolean;
  onToggleSelection?: () => void;
  sidePanel?: boolean;
  onOpenDialog?: (dialog: string | null) => void;
  onShowOutput?: (title: string, text: string) => void;
  onQuit?: () => void;
  onStatusChange?: (status: 'idle' | 'running' | 'completed' | 'paused' | 'failed') => void;
  notify?: (message: string) => void;
  refreshData?: () => void;
}

type FocusArea = 'agents' | 'workspace' | 'activity';

/** Multi-area terminal workspace driven entirely by real runtime events. */
export function MissionControl({
  context,
  active,
  eventBus,
  agentMode,
  onAgentMode,
  onOpenDialog,
  onShowOutput,
  onQuit,
  onStatusChange,
  notify,
  refreshData,
  resumeRequest = null,
  selectionMode = false,
  onToggleSelection,
  sidePanel = true,
}: MissionControlProps): React.ReactElement {
  const { columns, rows, compact } = useLayout();
  const [events, setEvents] = useState<AgentEvent[]>(() => {
    const tasks = context.store.listTasks({ projectPath: context.cwd, limit: 20 });
    const saved = tasks.find((task) => Array.isArray(task.metadata.agentEvents))
      ?.metadata.agentEvents as AgentEvent[] | undefined;
    return [...(saved ?? []), ...eventBus.history(40)].slice(-200);
  });
  const [focus, setFocus] = useState<FocusArea>('workspace');
  const [selectedAgent, setSelectedAgent] = useState(0);
  const [overlay, setOverlay] = useState<'inspector' | 'board' | null>(null);
  const [agentsVisible, setAgentsVisible] = useState(sidePanel);
  const [activityVisible, setActivityVisible] = useState(columns >= 130);

  useEffect(() => eventBus.subscribe((event) => {
    setEvents((previous) => [...previous.slice(-199), event]);
  }), [eventBus]);

  useInput(
    (input, key) => {
      if (!active) return;
      if (input === '\u001b[17~') {
        setAgentsVisible((visible) => !visible);
        return;
      }
      if (input === '\u001b[18~') {
        setActivityVisible((visible) => !visible);
        return;
      }
      if (key.escape) {
        setOverlay(null);
        return;
      }
      if (focus !== 'workspace' && input === 'i') {
        setOverlay('inspector');
        return;
      }
      if (focus !== 'workspace' && input === 't') {
        setOverlay('board');
        return;
      }
      if (focus !== 'workspace' && key.tab) {
        setFocus((current) =>
          current === 'agents' ? 'workspace' : current === 'workspace' ? 'activity' : 'agents',
        );
      }
      if (focus === 'agents' && (key.upArrow || key.downArrow)) {
        setSelectedAgent((current) =>
          Math.max(
            0,
            Math.min(AGENT_REGISTRY.length - 1, current + (key.downArrow ? 1 : -1)),
          ),
        );
      }
    },
    { isActive: active },
  );

  const showAgents = agentsVisible && !compact && columns >= 112;
  const showActivity = activityVisible && !compact && columns >= 100;
  const sideWidths = (showAgents ? 24 : 0) + (showActivity ? 26 : 0);
  const recent = useMemo(() => events.slice(-12).reverse(), [events]);
  const contracts = useMemo<TaskContract[]>(() => {
    const tasks = context.store.listTasks({ projectPath: context.cwd, limit: 20 });
    for (const task of tasks) {
      const saved = task.metadata.taskContracts;
      if (Array.isArray(saved)) return saved as TaskContract[];
    }
    return [];
  }, [context, events.length]);
  const agentStates = useMemo(() => deriveAgentStates(events, contracts), [events, contracts]);

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        {showAgents ? (
          <Box
            width={22}
            flexDirection="column"
            flexShrink={0}
            borderStyle="round"
            borderColor={focus === 'agents' ? theme.accent : theme.border}
            paddingX={1}
            overflow="hidden"
          >
            <Text color={theme.accent} bold>
              {glyph.brand} TEAM
            </Text>
            <Text color={theme.faint} dimColor>
              14 agents · {agentMode}
            </Text>
            {AGENT_REGISTRY.map((agent, index) => (
              <Text
                key={agent.id}
                color={index === selectedAgent ? theme.black : theme.muted}
                backgroundColor={index === selectedAgent ? theme.accent : undefined}
                wrap="truncate"
              >
                {agent.icon} {agent.name}
              </Text>
            ))}
          </Box>
        ) : null}

        <Box
          flexDirection="column"
          flexGrow={1}
          flexShrink={1}
          borderStyle={focus === 'workspace' ? 'round' : undefined}
          borderColor={theme.border}
          overflow="hidden"
        >
          <Workspace
            context={context}
            active={active && focus === 'workspace'}
            dimmed={!active}
            onStatusChange={onStatusChange ?? (() => {})}
            onNavigate={() => {}}
            onCycleScreen={() => {}}
            onOpenDialog={onOpenDialog ?? (() => {})}
            onQuit={onQuit ?? (() => {})}
            resumeRequest={resumeRequest}
            selectionMode={selectionMode}
            onToggleSelection={onToggleSelection}
            onShowOutput={onShowOutput}
            notify={notify ?? (() => {})}
            refreshData={refreshData ?? (() => {})}
            agentMode={agentMode}
            onAgentMode={onAgentMode}
            eventBus={eventBus}
            contentWidth={Math.max(24, columns - sideWidths - 6)}
          />
        </Box>

        {showActivity ? (
          <Box
            width={24}
            flexDirection="column"
            flexShrink={0}
            borderStyle="round"
            borderColor={focus === 'activity' ? theme.accent : theme.border}
            paddingX={1}
            overflow="hidden"
          >
            <Text color={theme.accent} bold>
              {glyph.dot} ACTIVITY
            </Text>
            <Text color={theme.faint} dimColor>
              {events.length} events · real runtime
            </Text>
            {recent.map((event, index) => (
              <Text key={`${event.timestamp}-${index}`} color={theme.muted} wrap="truncate">
                {event.type === 'agent.handoff'
                  ? `${String(event.payload.from ?? '')} → ${String(event.payload.to ?? '')}`
                  : event.type.startsWith('tool.')
                    ? `${event.type.replace('tool.', '')} ${String(event.payload.name ?? '')}`
                    : `${event.type.replace('agent.', '').replace('task.', '')} ${event.agentId ?? ''}`}
              </Text>
            ))}
            {recent.length === 0 ? (
              <Text color={theme.faint} dimColor>
                Waiting for agent activity…
              </Text>
            ) : null}
          </Box>
        ) : null}
      </Box>
      <Box flexShrink={0} paddingX={1}>
        <Text color={theme.faint} wrap="truncate">
          tab focus {focus} · ↑/↓ agents · i inspect · t tasks · f6 team · f7 activity · esc close · {rows} rows
        </Text>
      </Box>
      {overlay === 'inspector' ? (
        <Box position="absolute" bottom={2} right={2} width={58} flexDirection="column">
          <AgentInspector
            definition={getAgentDefinition(AGENT_REGISTRY[selectedAgent]!.id as AgentId)}
            state={agentStates[AGENT_REGISTRY[selectedAgent]!.id]!}
            recentEvents={events}
          />
        </Box>
      ) : null}
      {overlay === 'board' ? (
        <Box position="absolute" bottom={2} right={2} width={58} flexDirection="column">
          <TaskBoard contracts={contracts} />
        </Box>
      ) : null}
    </Box>
  );
}
