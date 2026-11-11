import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AppContext } from '../../core/app.js';
import { formatDateTime, formatRelative } from '../../cli/output.js';
import { Empty, Hint, PanelScreen, clip, clipLines, isEnter, useLayout } from '../components.js';
import { glyph, theme } from '../theme.js';

function statusColor(status: string): string {
  if (status === 'completed') return theme.success;
  if (status === 'running') return theme.accent;
  if (status === 'paused') return theme.warning;
  if (status === 'failed') return theme.danger;
  return theme.muted;
}

interface HistoryProps {
  context: AppContext;
  active: boolean;
  notify: (message: string) => void;
  refreshData: () => void;
  onOpenTask: (taskId: string, resume: boolean) => void;
  onCycleScreen: (direction: 1 | -1) => void;
  onBack: () => void;
  version: number;
}

export function HistoryScreen({
  context,
  active,
  notify,
  refreshData,
  onOpenTask,
  onCycleScreen,
  onBack,
  version,
}: HistoryProps): React.ReactElement {
  const { rows, columns } = useLayout();
  const [selected, setSelected] = useState(0);
  const [allProjects, setAllProjects] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tasks = useMemo(
    () =>
      context.store.listTasks({ projectPath: allProjects ? undefined : context.cwd, limit: 100 }),
    [context, allProjects, confirmDelete, version],
  );
  const current = tasks[Math.min(selected, Math.max(0, tasks.length - 1))] ?? null;

  useInput(
    (input, key) => {
      if (key.escape) {
        if (confirmDelete) setConfirmDelete(null);
        else onBack();
        return;
      }
      if (confirmDelete) {
        if (input === 'y' || input === 'Y') {
          const target = tasks.find((task) => task.id === confirmDelete);
          if (target) {
            context.store.deleteTask(target.id);
            setConfirmDelete(null);
            setSelected(0);
            setError(null);
            notify(`Deleted task ${target.id.slice(0, 8)}.`);
            refreshData();
          }
        } else if (input === 'n' || input === 'N') {
          setConfirmDelete(null);
        }
        return;
      }
      if (key.leftArrow) {
        onCycleScreen(-1);
        return;
      }
      if (key.rightArrow) {
        onCycleScreen(1);
        return;
      }
      if (key.tab) {
        onCycleScreen(key.shift ? -1 : 1);
        return;
      }
      if (key.upArrow || input === 'k') {
        setSelected((value) => (tasks.length === 0 ? 0 : (value - 1 + tasks.length) % tasks.length));
      } else if (key.downArrow || input === 'j') {
        setSelected((value) => (tasks.length === 0 ? 0 : (value + 1) % tasks.length));
      } else if (input === 'a') {
        setAllProjects((value) => !value);
        setSelected(0);
      } else if (current && (isEnter(input, key) || input === 'r')) {
        if (current.status === 'completed') {
          onOpenTask(current.id, false);
        } else {
          onOpenTask(current.id, true);
          notify(`Resuming ${current.id.slice(0, 8)}…`);
        }
      } else if (current && input === 'o') {
        onOpenTask(current.id, false);
      } else if (current && input === 'd') {
        setConfirmDelete(current.id);
      }
    },
    { isActive: active },
  );

  const windowSize = Math.max(4, Math.floor((rows - 16) / 2));
  const start = Math.max(
    0,
    Math.min(selected - Math.floor(windowSize / 2), tasks.length - windowSize),
  );

  return (
    <PanelScreen
      title="History"
      subtitle={`${tasks.length} ${allProjects ? 'across all projects' : 'in this project'}`}
    >
      {error ? <Text color={theme.danger}>{error}</Text> : null}
      {tasks.length === 0 ? (
        <Empty>No tasks yet. Describe a request in the workspace to start one.</Empty>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.faint}>
            {'  '}
            {'TASK'.padEnd(10)}
            {'STATUS'.padEnd(12)}
            {'PHASE'.padEnd(12)}
            {'UPDATED'.padEnd(12)}
            REQUEST
          </Text>
          {tasks.slice(start, start + windowSize).map((task, offset) => {
            const index = start + offset;
            const activeRow = index === selected;
            return (
              <Text key={task.id} color={activeRow ? theme.text : theme.muted}>
                {activeRow ? (
                  <Text color={theme.accent} bold>
                    {glyph.active}{' '}
                  </Text>
                ) : (
                  '  '
                )}
                {task.id.slice(0, 8).padEnd(10)}
                <Text color={statusColor(task.status)}>{task.status.padEnd(12)}</Text>
                <Text color={theme.faint}>{task.phase.padEnd(12)}</Text>
                <Text color={theme.faint}>{formatRelative(task.updatedAt).padEnd(12)}</Text>
                {clip(task.userRequest, Math.max(16, columns - 58))}
              </Text>
            );
          })}
        </Box>
      )}

      {current ? (
        <Box flexDirection="column" marginTop={1} overflow="hidden">
          <Text color={theme.border}>{glyph.rule.repeat(Math.max(10, columns - 4))}</Text>
          <Text bold color={theme.text} wrap="truncate">
            {clip(current.userRequest, Math.max(20, columns - 4))}
          </Text>
          <Text color={theme.faint} wrap="truncate">
            {current.projectName} {glyph.bullet} {current.taskType} {glyph.bullet} created{' '}
            {formatDateTime(current.createdAt)} {glyph.bullet} resumes {current.resumeCount}{' '}
            {glyph.bullet} model {current.currentModelId ?? '—'}
          </Text>
          {current.plan ? (
            <Box flexDirection="column">
              <Text color={theme.accent} wrap="truncate">
                plan {glyph.bullet} {current.plan.summary}
              </Text>
              {current.plan.steps.slice(0, 4).map((step) => (
                <Text key={step.title} color={theme.faint} wrap="truncate">
                  {'  '}[{step.status}] {clip(step.title, Math.max(16, columns - 12))}
                </Text>
              ))}
            </Box>
          ) : null}
          {current.changedFiles.length ? (
            <Text color={theme.muted} wrap="truncate">
              changed {glyph.bullet}{' '}
              {clip(current.changedFiles.join(', '), Math.max(20, columns - 14))}
            </Text>
          ) : null}
          {current.summary ? (
            <Text color={theme.success}>{clipLines(current.summary, 3, 500)}</Text>
          ) : null}
          {current.error ? (
            <Text color={theme.danger}>{clipLines(current.error, 2, 400)}</Text>
          ) : null}
          {current.attempts.length ? (
            <Text color={theme.faint} wrap="truncate">
              attempts {glyph.bullet}{' '}
              {current.attempts
                .slice(-3)
                .map((attempt) => `${attempt.modelId}:${attempt.category}`)
                .join(` ${glyph.bullet} `)}
            </Text>
          ) : null}
        </Box>
      ) : null}

      {confirmDelete ? (
        <Text color={theme.warning}>
          Delete task {confirmDelete.slice(0, 8)} and its transcript? <Text bold>y</Text> yes{' '}
          {glyph.bullet} <Text bold>n</Text> no
        </Text>
      ) : (
        <Box marginTop={1} flexShrink={0}>
          <Text color={theme.muted} wrap="truncate">
            <Text color={theme.accent}>enter</Text> resume/open {glyph.bullet}{' '}
            <Text color={theme.accent}>o</Text> open transcript {glyph.bullet}{' '}
            <Text color={theme.accent}>a</Text> {allProjects ? 'this project' : 'all projects'}{' '}
            {glyph.bullet} <Text color={theme.accent}>d</Text> delete
          </Text>
        </Box>
      )}
      <Hint>
        ↑/↓ move {glyph.bullet} ←/→ or tab screens {glyph.bullet} esc back to workspace
      </Hint>
    </PanelScreen>
  );
}
