import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AppContext } from '../../core/app.js';
import { gitSummary, type GitSummary } from '../../core/git/repository.js';
import { glyph, theme } from '../theme.js';
import { providerDisplayName } from '../../core/providers/definitions.js';
import { ModalWindow } from './modal.js';

interface StatusDialogProps {
  context: AppContext;
  taskId: string | null;
  onClose: () => void;
}

function lastCheckSucceeded(profile: {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
}): boolean {
  return Boolean(
    profile.lastSuccessAt && (!profile.lastErrorAt || profile.lastSuccessAt >= profile.lastErrorAt),
  );
}

function lastCheckFailed(profile: {
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}): boolean {
  return Boolean(
    profile.lastError &&
    (!profile.lastSuccessAt || !profile.lastErrorAt || profile.lastErrorAt > profile.lastSuccessAt),
  );
}

export function StatusDialog({ context, taskId, onClose }: StatusDialogProps): React.ReactElement {
  const [git, setGit] = useState<GitSummary | null>(null);

  const profiles = context.store.listProfiles();
  const activeProfileId = context.store.getSelectedProfileId();
  const activeModelId = context.store.getSelectedModelId();
  const settings = context.store.getSettings();
  const limits = context.store.listLimits(true);
  const task = taskId ? context.store.getTask(taskId) : null;

  useEffect(() => {
    let active = true;
    void gitSummary(context.cwd).then((sum) => {
      if (active) setGit(sum);
    });
    return () => {
      active = false;
    };
  }, [context]);

  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  return (
    <ModalWindow
      title="SYSTEM & QUOTA STATUS"
      subtitle={`${profiles.length} profile(s)`}
      width={72}
      height={18}
      borderColor={theme.info}
      footer={['esc close']}
    >
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {/* Active Model & Profile */}
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.accent} bold>
            Active Model & Routing
          </Text>
          <Text color={theme.text}>
            · Selected Profile:{' '}
            <Text color={theme.warm}>
              {profiles.find((p) => p.id === activeProfileId)?.name ?? '(none selected)'}
            </Text>
          </Text>
          <Text color={theme.text}>
            · Selected Model:{' '}
            <Text color={theme.warm}>{activeModelId ?? '(provider default)'}</Text>
          </Text>
          <Text color={theme.text}>
            · Paid Fallbacks:{' '}
            <Text color={settings.routing.allowPaid ? theme.warning : theme.success}>
              {settings.routing.allowPaid ? 'Paid fallbacks allowed' : 'Paid fallbacks disabled'}
            </Text>
          </Text>
        </Box>

        {/* Connected Providers & Limits */}
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.accent} bold>
            Provider Profiles ({profiles.length})
          </Text>
          {profiles.length === 0 ? (
            <Text color={theme.faint}>No provider profiles configured yet.</Text>
          ) : (
            profiles.map((p) => {
              const profileLimits = limits.filter((l) => l.profileId === p.id);
              const isLimited = profileLimits.length > 0;
              const status = !p.enabled
                ? 'Disabled'
                : isLimited
                  ? `Rate limited (${profileLimits.map((l) => l.category).join(', ')})`
                  : lastCheckFailed(p)
                    ? 'Last check failed'
                    : lastCheckSucceeded(p)
                      ? 'Last check passed'
                      : 'Not verified';
              return (
                <Box key={p.id} justifyContent="space-between">
                  <Text color={theme.text}>
                    {lastCheckSucceeded(p) ? glyph.check : glyph.ring} {p.name}{' '}
                    <Text color={theme.faint}>({providerDisplayName(p.providerId)})</Text>
                  </Text>
                  <Text
                    color={
                      isLimited || lastCheckFailed(p)
                        ? theme.danger
                        : lastCheckSucceeded(p)
                          ? theme.success
                          : theme.faint
                    }
                  >
                    {status}
                  </Text>
                </Box>
              );
            })
          )}
        </Box>

        {/* Git Status */}
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.accent} bold>
            Git Repository
          </Text>
          <Text color={theme.text}>
            · Branch: <Text color={theme.violet}>{git?.branch ?? '(not a git repo)'}</Text>
          </Text>
          <Text color={theme.text}>
            · Status:{' '}
            <Text color={git?.clean ? theme.success : theme.warning}>
              {git?.clean
                ? 'Clean working directory'
                : `${git?.files.length ?? 0} modified file(s)`}
            </Text>
          </Text>
        </Box>

        {/* Active Task */}
        {task ? (
          <Box flexDirection="column">
            <Text color={theme.accent} bold>
              Active Task ({task.id.slice(0, 8)})
            </Text>
            <Text color={theme.text}>
              · Status: <Text color={theme.warm}>{task.status}</Text> (Phase: {task.phase})
            </Text>
            <Text color={theme.text}>
              · Request: <Text color={theme.faint}>{task.userRequest.slice(0, 60)}</Text>
            </Text>
            <Text color={theme.text}>· Changed files: {task.changedFiles.length} file(s)</Text>
          </Box>
        ) : null}
      </Box>
    </ModalWindow>
  );
}
