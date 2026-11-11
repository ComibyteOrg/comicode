import React from 'react';
import type { AppContext } from '../../core/app.js';
import { ProvidersScreen } from '../screens/providers.js';
import type { AgentStatus } from '../components.js';

interface ProvidersDialogProps {
  context: AppContext;
  onClose: () => void;
  notify: (message: string) => void;
  refreshData: () => void;
  onStatusChange?: (status: AgentStatus) => void;
  onRequestConnect?: () => void;
}

/**
 * Provider/profile manager rendered as a centered modal dialog. Reuses the
 * full provider screen (list, details, add/edit wizard, test, refresh,
 * enable/disable, delete) in embedded mode so the chat stays visible behind it.
 */
export function ProvidersDialog({
  context,
  onClose,
  notify,
  refreshData,
  onStatusChange,
  onRequestConnect,
}: ProvidersDialogProps): React.ReactElement {
  return (
    <ProvidersScreen
      context={context}
      active
      notify={notify}
      refreshData={refreshData}
      onStatusChange={onStatusChange ?? (() => {})}
      onCycleScreen={() => {}}
      onBack={onClose}
      embedded
      onRequestConnect={onRequestConnect}
    />
  );
}
