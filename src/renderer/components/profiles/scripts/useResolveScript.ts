import { useEffect, useState } from 'react';
import { sourceKey, type ProfileScript } from '../../../../common/profileScripts';
import type { MacroInfo, MacroCode } from '../../../../main/src/types';
import { ResolvedProfileScript } from 'main/src/functions/ProfileScripts';

export interface ResolvedView {
  info: MacroInfo | null;
  code: MacroCode | null;
  checksumOk: boolean;
  signatureOk: boolean;
  verified: boolean;
  loading: boolean;
  error: string | null;
}

/**
 * Resolve a `ProfileScript` to its info+code via IPC. Re-runs whenever the
 * script's `source` or `checksum` changes — the wizard expects the latest
 * value reflected immediately after the user edits the script entry.
 *
 * No caching layer: each render that needs the resolved data invokes the
 * IPC handler. Phase 5 (caching) is explicitly out of scope.
 */
export function useResolveScript(
  script: ProfileScript | null,
): ResolvedView {
  const [view, setView] = useState<ResolvedView>({
    info: null,
    code: null,
    checksumOk: false,
    signatureOk: false,
    verified: false,
    loading: !!script,
    error: null,
  });

  const sourceId = script ? sourceKey(script.source) : '';

  // Re-resolve only when the identity fields below change, not on script object identity.
  /* oxlint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!script) {
      setView((v) => ({ ...v, loading: false }));
      return;
    }
    let cancelled = false;
    setView((v) => ({ ...v, loading: true, error: null }));
    window.ipcRenderer
      .invoke<ResolvedProfileScript & { error: string }>('profile-script-resolve', script)
      .then((res) => {
        if (cancelled) return;
        if (res?.error) {
          setView({
            info: null,
            code: null,
            checksumOk: false,
            signatureOk: false,
            verified: false,
            loading: false,
            error: res.error,
          });
        } else {
          setView({
            info: res.info ?? null,
            code: res.code ?? null,
            checksumOk: !!res.checksumOk,
            signatureOk: !!res.signatureOk,
            verified: !!res.verified,
            loading: false,
            error: null,
          });
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        setView({
          info: null,
          code: null,
          checksumOk: false,
          signatureOk: false,
          verified: false,
          loading: false,
          error: err?.message ?? 'Failed',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    script?.id,
    sourceId,
    script?.checksum,
    script?.signature,
  ]);

  /* oxlint-enable react-hooks/exhaustive-deps */
  return view;
}
