import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AppContext } from '../../core/app.js';
import { planUndo, performUndo, type UndoPlan } from '../../core/git/repository.js';
import { Spinner } from '../components.js';
import { theme } from '../theme.js';
import { ModalWindow } from './modal.js';

interface UndoDialogProps {
  context: AppContext;
  taskId: string | null;
  onClose: () => void;
  notify: (message: string) => void;
  refreshData: () => void;
}

export function UndoDialog({
  context,
  taskId,
  onClose,
  notify,
  refreshData,
}: UndoDialogProps): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<UndoPlan | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const task = taskId ? context.store.getTask(taskId) : null;

  useEffect(() => {
    let active = true;
    async function computePlan() {
      if (!task) {
        setLoading(false);
        return;
      }
      try {
        const undoPlan = await planUndo(context.cwd, task);
        if (active) setPlan(undoPlan);
      } catch (err) {
        if (active) {
          setPlan({
            supported: false,
            reason: String(err),
            items: [],
            skipped: [],
            restoreCount: 0,
            deleteCount: 0,
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void computePlan();
    return () => {
      active = false;
    };
  }, [context, task]);

  const executeUndo = async () => {
    if (!plan || !plan.supported || plan.items.length === 0) return;
    setStatusMessage('Restoring files from baseline snapshot…');
    try {
      const res = await performUndo(context.cwd, plan);
      if (res.ok) {
        notify(
          `Safely reverted ${res.restored.length} file(s) and deleted ${res.deleted.length} created file(s).`,
        );
        refreshData();
        setDone(true);
        setTimeout(onClose, 800);
      } else {
        notify(`Undo completed with errors: ${res.failed.map((f) => f.message).join(', ')}`);
        onClose();
      }
    } catch (err) {
      notify(`Undo failed: ${String(err)}`);
      onClose();
    }
  };

  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === 'n') {
      onClose();
      return;
    }
    if (input.toLowerCase() === 'y' || key.return) {
      if (plan && plan.supported && plan.items.length > 0 && !done && !statusMessage) {
        void executeUndo();
      }
    }
  });

  if (!task) {
    return (
      <ModalWindow
        title="SAFE UNDO"
        width={68}
        height={10}
        borderColor={theme.warning}
        footer={['esc close']}
      >
        <Text bold color={theme.warning}>
          No active task
        </Text>
        <Text color={theme.muted}>
          Undo requires an active task that modified files. Start or resume a task first.
        </Text>
      </ModalWindow>
    );
  }

  return (
    <ModalWindow
      title={`SAFE UNDO — TASK ${task.id.slice(0, 8)}`}
      width={72}
      height={18}
      borderColor={theme.warning}
      footer={['y confirm revert', 'n / esc cancel']}
    >
      {loading ? (
        <Box marginY={2}>
          <Spinner frame={0} label="Analyzing task baseline snapshot and safety checks…" />
        </Box>
      ) : statusMessage ? (
        <Box marginY={2}>
          <Spinner frame={0} label={statusMessage} />
        </Box>
      ) : (
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {!plan?.supported ? (
            <Box flexDirection="column">
              <Text color={theme.danger} bold>
                Undo not possible for this task
              </Text>
              <Text color={theme.muted}>
                {plan?.reason ??
                  'No baseline snapshot was recorded for this task or git is unavailable.'}
              </Text>
            </Box>
          ) : plan.items.length === 0 ? (
            <Box flexDirection="column">
              <Text color={theme.success}>No modified files to revert.</Text>
              <Text color={theme.muted}>
                The task did not alter any files or files are already in their pre-task state.
              </Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text color={theme.text} bold>
                The following actions will be performed safely:
              </Text>
              <Box flexDirection="column" marginY={1}>
                {plan.items.map((item) => (
                  <Box key={item.path}>
                    <Text color={item.action === 'restore' ? theme.warning : theme.danger}>
                      {item.action === 'restore' ? '↺ restore' : '✕ delete'}:{' '}
                    </Text>
                    <Text color={theme.text}>{item.path}</Text>
                    <Text color={theme.faint}> ({item.reason})</Text>
                  </Box>
                ))}
              </Box>

              {plan.skipped.length > 0 ? (
                <Box flexDirection="column" marginTop={1}>
                  <Text color={theme.info}>
                    Notice: {plan.skipped.length} file(s) will be protected and preserved:
                  </Text>
                  {plan.skipped.map((skip) => (
                    <Text key={skip.path} color={theme.faint}>
                      · {skip.path}: {skip.reason}
                    </Text>
                  ))}
                </Box>
              ) : null}

              <Box marginTop={1}>
                <Text color={theme.warm} bold>
                  Are you sure you want to revert these files? (y / n)
                </Text>
              </Box>
            </Box>
          )}
        </Box>
      )}
    </ModalWindow>
  );
}
