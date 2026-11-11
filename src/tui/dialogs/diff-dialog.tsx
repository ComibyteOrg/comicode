import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AppContext } from '../../core/app.js';
import { gitDiffForFiles, gitSummary, type GitSummary } from '../../core/git/repository.js';
import { Spinner } from '../components.js';
import { theme } from '../theme.js';
import { ModalWindow } from './modal.js';

interface DiffDialogProps {
  context: AppContext;
  taskId: string | null;
  onClose: () => void;
}

export function DiffDialog({ context, taskId, onClose }: DiffDialogProps): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<GitSummary | null>(null);
  const [diffText, setDiffText] = useState<string>('');
  const [scrollOffset, setScrollOffset] = useState(0);

  useEffect(() => {
    let active = true;
    async function loadDiff() {
      setLoading(true);
      try {
        const sum = await gitSummary(context.cwd);
        if (!active) return;
        setSummary(sum);

        const task = taskId ? context.store.getTask(taskId) : null;
        const targetFiles =
          task && task.changedFiles.length > 0 ? task.changedFiles : sum.files.map((f) => f.path);

        if (targetFiles.length > 0) {
          const diffRes = await gitDiffForFiles(context.cwd, targetFiles);
          if (active) setDiffText(diffRes || 'No differences detected in changed files.');
        } else {
          if (active) setDiffText('No files have been modified yet.');
        }
      } catch (err) {
        if (active) setDiffText(`Failed to load diff: ${String(err)}`);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadDiff();
    return () => {
      active = false;
    };
  }, [context, taskId]);

  const diffLines = diffText.split(/\r?\n/);
  const visibleLineCount = 10;
  const maxScroll = Math.max(0, diffLines.length - visibleLineCount);
  const visibleLines = diffLines.slice(scrollOffset, scrollOffset + visibleLineCount);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setScrollOffset((v) => Math.max(0, v - 1));
      return;
    }
    if (key.downArrow) {
      setScrollOffset((v) => Math.min(maxScroll, v + 1));
      return;
    }
    if (key.pageUp) {
      setScrollOffset((v) => Math.max(0, v - 10));
      return;
    }
    if (key.pageDown) {
      setScrollOffset((v) => Math.min(maxScroll, v + 10));
      return;
    }
  });

  return (
    <ModalWindow
      title={`GIT DIFF ${taskId ? `(Task ${taskId.slice(0, 8)})` : ''}`}
      subtitle={
        summary?.branch
          ? `⎇ ${summary.branch} · ${diffLines.length} lines`
          : `${diffLines.length} lines`
      }
      width={74}
      height={18}
      footer={[
        summary?.clean ? 'tree clean' : `${summary?.files.length ?? 0} modified`,
        '↑/↓ scroll',
        'esc close',
      ]}
    >
      {loading ? (
        <Box marginY={2}>
          <Spinner frame={0} label="Reading git diff…" />
        </Box>
      ) : (
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {visibleLines.map((line, idx) => {
            let color: string = theme.text;
            if (line.startsWith('+') && !line.startsWith('+++')) color = theme.success;
            else if (line.startsWith('-') && !line.startsWith('---')) color = theme.danger;
            else if (line.startsWith('@@')) color = theme.info;
            else if (line.startsWith('diff ') || line.startsWith('index ')) color = theme.faint;

            return (
              <Text key={`${scrollOffset + idx}`} color={color} wrap="truncate">
                {line || ' '}
              </Text>
            );
          })}
        </Box>
      )}
    </ModalWindow>
  );
}
