import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createContext, useContext } from 'react';
import { useSettingsStore, selectActiveServerId } from 'renderer/redux/settings';

export type PanelState = {
  active: boolean;
  tab: string;
  data?: unknown;
};

/**
 * Error a script raised against one of its settings (`script.optionError(...)`).
 * Stored keyed by `pluginId -> field -> message`.
 */
export type OptionErrorMap = Record<string, Record<string, string>>;

export type PanelContextType = {
  panel: PanelState;
  setPanel: React.Dispatch<React.SetStateAction<PanelState>>;
  optionErrors: OptionErrorMap;
  setOptionError: (pluginId: string, field: string, message: string) => void;
  clearOptionError: (pluginId: string, field?: string) => void;
};

export const PanelContext = createContext<PanelContextType | undefined>(
  undefined,
);

export const usePanelContext = (): PanelContextType => {
  const context = useContext(PanelContext);
  if (!context) {
    throw new Error('usePanelContext must be used within Sidebar');
  }
  return context;
};

const SidePanelContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [panel, setPanel] = useState<PanelState>({
    active: false,
    tab: 'logs',
  });
  const [optionErrors, setOptionErrors] = useState<OptionErrorMap>({});

  // The panel's contents (selected bot, inventory, plugin data, ...) are
  // per-profile, so they go stale when the user switches profile. Rather than
  // re-wiring every tab to react to the swap, just close the panel on switch.
  const activeServer = useSettingsStore(selectActiveServerId);
  const prevServer = useRef(activeServer);
  useEffect(() => {
    if (prevServer.current !== activeServer) {
      prevServer.current = activeServer;
      setPanel((p) => (p.active ? { ...p, active: false } : p));
    }
  }, [activeServer]);

  const setOptionError = useCallback(
    (pluginId: string, field: string, message: string) => {
      setOptionErrors((prev) => ({
        ...prev,
        [pluginId]: { ...(prev[pluginId] ?? {}), [field]: message },
      }));
    },
    [],
  );

  const clearOptionError = useCallback(
    (pluginId: string, field?: string) => {
      setOptionErrors((prev) => {
        if (!prev[pluginId]) return prev;
        if (!field) {
          const { [pluginId]: _omit, ...rest } = prev;
          return rest;
        }
        const next = { ...prev[pluginId] };
        delete next[field];
        if (Object.keys(next).length === 0) {
          const { [pluginId]: _omit, ...rest } = prev;
          return rest;
        }
        return { ...prev, [pluginId]: next };
      });
    },
    [],
  );

  const value = useMemo(
    () => ({ panel, setPanel, optionErrors, setOptionError, clearOptionError }),
    [panel, optionErrors, setOptionError, clearOptionError],
  );

  return (
    <PanelContext.Provider value={value}>
      {children}
    </PanelContext.Provider>
  );
};

export default SidePanelContextProvider;
