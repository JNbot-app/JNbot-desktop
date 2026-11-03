import { FC, useEffect, useMemo, useState } from 'react';
import { Alert, Empty, Select, Space, Typography, theme } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  useSettingsStore,
  selectAlts,
  selectAppSettings,
} from 'renderer/redux/settings';
import AccountProfileView from '../accountProfile/AccountProfileView';
import type { MacroInfo } from 'main/src/types';
import type { ProfileUiJson } from 'common/profileUiSchema';

const { Text } = Typography;

interface PreviewLog {
  level: 'log' | 'warn' | 'error' | 'info';
  text: string;
}

export interface PreviewProps {
  /** Live editor source — read fresh on every run. */
  codeRef: React.RefObject<string>;
  macroInfo: MacroInfo;
  /** Bumped by the editor's Run button to force a re-run. */
  nonce: number;
}

const logColor: Record<PreviewLog['level'], string | undefined> = {
  log: undefined,
  info: undefined,
  warn: '#d89614',
  error: '#ff4d4f',
};

/**
 * Side-panel tab that renders a live preview of a profile-UI plugin by
 * running the unsaved editor source in the main-process sandbox and drawing
 * the returned JSON with the same account profile view used by the side panel.
 */
const ProfileUiPreviewTab: FC<{ preview: PreviewProps }> = ({ preview }) => {
  const { codeRef, macroInfo, nonce } = preview;
  const { token } = theme.useToken();
  const alts = useSettingsStore(selectAlts);
  const server = useSettingsStore(selectAppSettings).server;

  const [username, setUsername] = useState<string>(
    alts[0]?.username ?? 'notch',
  );
  const [state, setState] = useState<{
    json: ProfileUiJson | null;
    error?: string;
    logs: PreviewLog[];
    loading: boolean;
  }>({ json: null, logs: [], loading: false });

  const runPreview = async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const res: any = await window.ipcRenderer.invoke(
        'profile-ui-preview-code',
        {
          code: codeRef.current ?? '',
          language: macroInfo.language,
          server,
          username,
        },
      );
      setState({
        json: res?.ok ? res.json : null,
        error: res?.ok ? undefined : res?.error ?? 'Preview failed',
        logs: res?.logs ?? [],
        loading: false,
      });
    } catch (err: any) {
      setState({
        json: null,
        error: err?.message ?? 'Preview failed',
        logs: [],
        loading: false,
      });
    }
  };

  // Re-run whenever the editor requests it (nonce) or the player changes.
  useEffect(() => {
    runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, username]);

  const altOptions = useMemo(
    () => alts.map((a) => ({ value: a.username, label: a.username })),
    [alts],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        height: '100%',
      }}
    >
      <Space>
        <Text type="secondary">Preview as</Text>
        <Select
          size="small"
          value={username}
          onChange={setUsername}
          options={
            altOptions.length
              ? altOptions
              : [{ value: username, label: username }]
          }
          style={{ minWidth: 140 }}
        />
        <Typography.Link onClick={runPreview}>
          <ReloadOutlined /> Refresh
        </Typography.Link>
      </Space>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {state.error ? (
          <Alert
            type="error"
            showIcon
            title="Preview failed"
            description={state.error}
          />
        ) : !state.json && !state.loading ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Run the plugin to see a preview"
          />
        ) : (
          <AccountProfileView
            json={state.json}
            loading={state.loading}
            error={state.error}
          />
        )}
      </div>

      {state.logs.length > 0 && (
        <div
          style={{
            flexShrink: 0,
            maxHeight: 160,
            overflow: 'auto',
            borderRadius: 8,
            border: '1px solid rgba(128,128,128,0.18)',
            background: 'rgba(0,0,0,0.15)',
            padding: 8,
            fontFamily: 'Menlo, monospace',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
          }}
        >
          {state.logs.map((l, i) => (
            <div
              key={i}
              style={{ color: logColor[l.level] ?? token.colorText }}
            >
              {l.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProfileUiPreviewTab;
