import { useEffect } from 'react';
import { useSettingsStore, setMacros } from '../../redux/settings';
import type { MacroInfo } from '../../../main/src/types';
import { initShares } from '../../redux/shares';

/**
 * One-time mount hook that:
 *  - hydrates `macros` from localStorage cache (when empty)
 *  - subscribes to the live MACROS IPC event
 *  - asks the backend for the current list (also fires on create/save/delete server-side)
 *  - loads shares (and their once-a-day update check)
 */
export const useMacrosBootstrap = () => {
  useEffect(() => {
    // Hydrate from cache only when the store is still empty — avoids overwriting a fresh list.
    if (!useSettingsStore.getState().macros.loaded) {
      try {
        const raw = window.localStorage.getItem('macros_cache');
        if (raw) {
          const arr = JSON.parse(raw) as MacroInfo[];
          if (Array.isArray(arr)) setMacros(arr);
        }
      } catch {}
    }

    const off = window.ipcRenderer.on('MACROS', (d) => {
      if (!Array.isArray(d)) return;
      d.forEach((p: MacroInfo) => (p.pluginId ??= p.publicKey ?? p.name));
      try {
        window.localStorage.setItem('macros_cache', JSON.stringify(d));
      } catch {}
      setMacros(d);
    });

    window.ipcRenderer.action('GET_MACROS');
    initShares();

    return off;
  }, []);
};
