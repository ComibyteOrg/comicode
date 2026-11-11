import React from 'react';
import { Box, Text, useInput } from 'ink';
import { shortcutLines } from '../shortcuts/manager.js';
import { theme } from '../theme.js';
import { ModalWindow } from './modal.js';

interface ShortcutsDialogProps {
  onClose: () => void;
}

export function ShortcutsDialog({ onClose }: ShortcutsDialogProps): React.ReactElement {
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  const lines = shortcutLines();

  return (
    <ModalWindow
      title="KEYBOARD SHORTCUTS"
      subtitle={`${lines.length} shortcuts`}
      width={70}
      height={18}
      borderColor={theme.accent}
      footer={['esc close']}
    >
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {lines.map((line, idx) => {
          const isCategory = line === 'GLOBAL' || line === 'WORKSPACE' || line === 'DIALOGS';
          return (
            <Text
              key={idx}
              color={isCategory ? theme.accent : theme.text}
              bold={isCategory}
              wrap="truncate"
            >
              {line || ' '}
            </Text>
          );
        })}
      </Box>
    </ModalWindow>
  );
}
