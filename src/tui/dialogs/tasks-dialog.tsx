import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AppContext } from '../../core/app.js';
import type { TaskRecord } from '../../core/types.js';
import { Selector, filterByQuery, type SelectorItem } from './selector.js';
import { PromptInput } from '../components.js';
import { ModalWindow } from './modal.js';
import { theme } from '../theme.js';
import { formatRelative } from '../../cli/output.js';

interface TasksDialogProps {
  context: AppContext;
  onClose: () => void;
  onOpenTask: (taskId: string, resume: boolean) => void;
  onNewTask: () => void;
  notify: (message: string) => void;
  refreshData: () => void;
}

function statusColor(status: string): string {
  if (status === 'completed') return theme.success;
  if (status === 'running') return theme.accent;
  if (status === 'paused') return theme.warning;
  if (status === 'failed') return theme.danger;
  return theme.faint;
}

function taskTitle(task: TaskRecord): string {
  const title = task.metadata.title;
  return typeof title === 'string' && title.trim() ? title : task.userRequest;
}

export function TasksDialog({
  context,
  onClose,
  onOpenTask,
  onNewTask,
  notify,
  refreshData,
}: TasksDialogProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<TaskRecord | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [version, setVersion] = useState(0);

  const tasks = useMemo(
    () => context.store.listTasks({ projectPath: context.cwd, limit: 100 }),
    [context, version],
  );

  const filteredTasks = useMemo(() => {
    return filterByQuery(tasks, query, (task) => [
      task.id,
      task.userRequest,
      taskTitle(task),
      task.status,
      task.currentModelId ?? '',
      task.projectName,
    ]);
  }, [tasks, query]);

  const items: SelectorItem[] = useMemo(
    () =>
      filteredTasks.map((task) => {
        const changes = task.changedFiles.length;
        const changeLabel = changes > 0 ? `${changes} file${changes > 1 ? 's' : ''}` : 'no edits';
        const dateStr = formatRelative(task.updatedAt);
        return {
          key: task.id,
          label: `${task.id.slice(0, 8)}: ${taskTitle(task).slice(0, 60)}`,
          detail: `${task.projectName} · ${task.currentModelId ?? 'no model'} · ${changeLabel} · ${dateStr}`,
          badge: task.status,
          badgeColor: statusColor(task.status),
        };
      }),
    [filteredTasks],
  );

  const handleSelect = (item: SelectorItem) => {
    const task = filteredTasks.find((t) => t.id === item.key);
    if (!task) return;
    const shouldResume = task.status === 'paused' || task.status === 'failed';
    onOpenTask(task.id, shouldResume);
    onClose();
  };

  const handleDelete = (task: TaskRecord): void => {
    try {
      context.store.deleteTask(task.id);
      notify(`Deleted task ${task.id.slice(0, 8)}.`);
      setConfirmDelete(null);
      setVersion((value) => value + 1);
      refreshData();
    } catch (err) {
      notify(`Failed to delete task: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDeleteAll = (): void => {
    try {
      let deleted = 0;
      let skipped = 0;
      for (const task of tasks) {
        if (task.status === 'running') {
          skipped += 1;
          continue;
        }
        context.store.deleteTask(task.id);
        deleted += 1;
      }
      notify(
        skipped > 0
          ? `Deleted ${deleted} task(s); skipped ${skipped} still running.`
          : `Deleted ${deleted} task(s) and their history.`,
      );
      setConfirmDeleteAll(false);
      setVersion((value) => value + 1);
      refreshData();
    } catch (err) {
      notify(`Failed to delete tasks: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const saveRename = (): void => {
    if (!renamingId) return;
    const title = renameValue.trim();
    if (!title) {
      notify('Task title cannot be empty.');
      return;
    }
    try {
      const task = context.store.getTask(renamingId);
      if (!task) throw new Error('Task no longer exists.');
      context.store.updateTask(task.id, {
        metadata: { ...task.metadata, title },
      });
      notify(`Renamed task to "${title}".`);
      setRenamingId(null);
      setVersion((value) => value + 1);
      refreshData();
    } catch (err) {
      notify(`Failed to rename task: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  useInput((input, key) => {
    if (renamingId) {
      if (key.escape) {
        setRenamingId(null);
        return;
      }
      if (key.ctrl && input.toLowerCase() === 's') {
        saveRename();
      }
      return;
    }
    if (confirmDelete) {
      if (key.escape || input.toLowerCase() === 'n') {
        setConfirmDelete(null);
      } else if (input.toLowerCase() === 'y' || key.return) {
        handleDelete(confirmDelete);
      }
      return;
    }
    if (confirmDeleteAll) {
      if (key.escape || input.toLowerCase() === 'n') {
        setConfirmDeleteAll(false);
      } else if (input.toLowerCase() === 'y' || key.return) {
        handleDeleteAll();
      }
      return;
    }
  });

  if (renamingId) {
    return (
      <ModalWindow
        title="RENAME TASK"
        subtitle="Give this saved task a display name"
        width={64}
        height={12}
        footer={['enter or ctrl+s save', 'esc cancel']}
      >
        <Box marginTop={1}>
          <PromptInput
            value={renameValue}
            onChange={setRenameValue}
            onSubmit={saveRename}
            focus
            placeholder="Task title"
          />
        </Box>
      </ModalWindow>
    );
  }

  if (confirmDelete) {
    return (
      <ModalWindow
        title="DELETE SAVED TASK?"
        subtitle="This permanently removes its conversation and checkpoints"
        width={64}
        height={12}
        borderColor={theme.warning}
        footer={['y confirm', 'n or esc cancel']}
      >
        <Box marginTop={1}>
          <Text color={theme.text} wrap="wrap">
            {taskTitle(confirmDelete)}
          </Text>
        </Box>
      </ModalWindow>
    );
  }

  if (confirmDeleteAll) {
    return (
      <ModalWindow
        title="DELETE ALL TASK HISTORY?"
        subtitle="Removes every saved task, message, and checkpoint in this project"
        width={64}
        height={12}
        borderColor={theme.danger}
        footer={['y confirm', 'n or esc cancel']}
      >
        <Box marginTop={1}>
          <Text color={theme.text} wrap="wrap">
            {tasks.filter((t) => t.status !== 'running').length} task(s) will be permanently
            deleted. Running tasks are skipped. Provider profiles and settings are kept.
          </Text>
        </Box>
      </ModalWindow>
    );
  }

  return (
    <Selector
      title="TASKS & SESSIONS"
      subtitle={`${filteredTasks.length} task${filteredTasks.length !== 1 ? 's' : ''} in this project`}
      items={items}
      query={query}
      onQueryChange={setQuery}
      selected={selected}
      onSelectedChange={setSelected}
      onSelect={handleSelect}
      onClose={onClose}
      searchPlaceholder="Filter tasks by prompt, id, model, or status…"
      emptyText="No matching tasks found."
      footer={[
        '↑↓ navigate',
        'enter open/continue',
        'ctrl+n new task',
        'ctrl+r rename',
        'ctrl+d delete this task',
        'ctrl+x clear all tasks',
        'esc close',
      ]}
      onKey={(input, key, currentItem) => {
        if (key.ctrl && input === 'n') {
          onNewTask();
          onClose();
          return true;
        }
        if (key.ctrl && input === 'd') {
          if (currentItem) {
            const task = filteredTasks.find((t) => t.id === currentItem.key);
            if (task) setConfirmDelete(task);
          }
          return true;
        }
        if (key.ctrl && input === 'r') {
          if (currentItem) {
            const task = filteredTasks.find((t) => t.id === currentItem.key);
            if (task) {
              setRenamingId(task.id);
              setRenameValue(taskTitle(task));
            }
          }
          return true;
        }
        if (key.ctrl && input === 'x') {
          if (tasks.length > 0) setConfirmDeleteAll(true);
          return true;
        }
        return false;
      }}
    />
  );
}
