import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useLayout } from '../components.js';
import { theme } from '../theme.js';
import { ModalWindow } from './modal.js';

interface OutputDialogProps {
  title: string;
  text: string;
  onClose: () => void;
}

/** Scrollable read-only text popup for slash-command output (/help, /skills, ...). */
export function OutputDialog({ title, text, onClose }: OutputDialogProps): React.ReactElement {
  const { rows } = useLayout();
  const lines = text.replace(/\t/g, '  ').split('\n');
  const height = Math.min(rows - 4, 30);
  const inner = Math.max(4, height - 7);
  const maxOffset = Math.max(0, lines.length - inner);
  const [offset, setOffset] = useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) setOffset((value) => Math.max(0, value - 1));
    else if (key.downArrow) setOffset((value) => Math.min(maxOffset, value + 1));
    else if (key.pageUp) setOffset((value) => Math.max(0, value - inner));
    else if (key.pageDown) setOffset((value) => Math.min(maxOffset, value + inner));
    else if (key.home) setOffset(0);
    else if (key.end) setOffset(maxOffset);
  });

  const clamped = Math.min(offset, maxOffset);
  const visible = lines.slice(clamped, clamped + inner);

  return (
    <ModalWindow
      title={title.toUpperCase()}
      subtitle={`${lines.length} lines · ↑/↓ scroll`}
      width={72}
      height={height}
      footer={['↑/↓ scroll', 'pgup/pgdn page', 'esc close']}
    >
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visible.map((line, index) => (
          <Text key={clamped + index} color={theme.text} wrap="truncate">
            {line || ' '}
          </Text>
        ))}
        {clamped > 0 || clamped + inner < lines.length ? (
          <Text color={theme.faint}>
            {`  ⋯ ${clamped + 1}-${Math.min(clamped + inner, lines.length)} of ${lines.length}`}
          </Text>
        ) : null}
      </Box>
    </ModalWindow>
  );
}
