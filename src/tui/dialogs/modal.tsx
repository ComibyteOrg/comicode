import React, { createContext, useContext } from 'react';
import { Box, Text } from 'ink';
import { glyph, theme } from '../theme.js';
import { useLayout } from '../components.js';

export type ModalId =
  | 'palette'
  | 'model-picker'
  | 'connect'
  | 'tasks'
  | 'diff'
  | 'undo'
  | 'status'
  | 'usage'
  | 'settings'
  | 'shortcuts';

export interface ModalEntry {
  id: ModalId;
  props?: Record<string, unknown>;
}

export interface ModalContextType {
  activeModal: ModalEntry | null;
  modalStack: ModalEntry[];
  openModal: (id: ModalId, props?: Record<string, unknown>) => void;
  closeModal: () => void;
  replaceModal: (id: ModalId, props?: Record<string, unknown>) => void;
  closeAllModals: () => void;
}

export const ModalContext = createContext<ModalContextType>({
  activeModal: null,
  modalStack: [],
  openModal: () => {},
  closeModal: () => {},
  replaceModal: () => {},
  closeAllModals: () => {},
});

export function useModal(): ModalContextType {
  return useContext(ModalContext);
}

export interface ModalWindowProps {
  title?: string;
  subtitle?: string;
  width?: number;
  height?: number;
  borderColor?: string;
  footer?: string[];
  children: React.ReactNode;
}

/**
 * Centered floating modal window in OpenCode terminal style.
 * Renders absolutely positioned over the dimmed workspace background.
 */
export function ModalWindow({
  title,
  subtitle,
  width = 72,
  height = 20,
  borderColor = theme.accent,
  footer = ['↑↓ navigate', 'enter select', 'esc close'],
  children,
}: ModalWindowProps): React.ReactElement {
  const { columns, rows } = useLayout();
  const modalWidth = Math.max(36, Math.min(columns - 4, width));
  const modalHeight = Math.max(8, Math.min(rows - 4, height));

  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      width={columns}
      height={rows}
      justifyContent="center"
      alignItems="center"
    >
      <Box
        width={modalWidth}
        height={modalHeight}
        borderStyle="round"
        borderColor={borderColor}
        backgroundColor={theme.surface}
        flexDirection="column"
        overflow="hidden"
        paddingX={1}
      >
        {title ? (
          <Box flexDirection="column" flexShrink={0} marginBottom={1}>
            <Text bold color={theme.text} wrap="truncate">
              <Text color={borderColor}>{glyph.brand} </Text>
              {title}
            </Text>
            {subtitle ? (
              <Text color={theme.faint} wrap="truncate">
                {subtitle}
              </Text>
            ) : null}
          </Box>
        ) : null}

        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {children}
        </Box>

        {footer && footer.length > 0 ? (
          <Box flexShrink={0} marginTop={1} justifyContent="space-between">
            <Text color={theme.faint} wrap="truncate">
              {footer.join(`  ${glyph.bullet}  `)}
            </Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
