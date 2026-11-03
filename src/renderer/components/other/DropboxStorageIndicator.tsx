import React, { useEffect, useState } from 'react';
import { Badge, Button, Tooltip, theme } from 'antd';
import { DropboxOutlined, SyncOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

type StorageStatus = {
  mode: 'local' | 'dropbox';
  connected?: boolean;
  account?: { id: string; email?: string; name?: string };
  writes?: { saving?: boolean; lastSavedAt?: number; lastError?: string };
  startupError?: string;
};

function DropboxStorageIndicator() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const { token } = theme.useToken();
  const navigate = useNavigate();

  useEffect(() => {
    if (window.web) return undefined;
    let cancelled = false;

    window.ipcRenderer
      .invoke<StorageStatus>('storage:status')
      .then((res) => {
        if (!cancelled && res?.mode === 'dropbox') {
          setStatus(res);
        }
        return undefined;
      })
      .catch(() => undefined);

    const stopWrites = window.ipcRenderer.on?.(
      'storage:write-status',
      (writes: StorageStatus['writes']) => {
        if (!cancelled) {
          setStatus((prev) => (prev ? { ...prev, writes } : prev));
        }
      },
    );

    return () => {
      cancelled = true;
      stopWrites?.();
    };
  }, []);

  if (!status || status.mode !== 'dropbox') return null;

  const isSaving = Boolean(status.writes?.saving);
  const errorMsg = status.writes?.lastError || status.startupError;
  const hasError = Boolean(errorMsg);
  const accountLabel = status.account?.name || status.account?.email;

  const tooltipTitle = isSaving
    ? 'Dropbox: Syncing changes…'
    : hasError
    ? `Dropbox: ${errorMsg}`
    : accountLabel
    ? `Dropbox: ${accountLabel}`
    : 'Dropbox storage';

  return (
    <Tooltip title={tooltipTitle}>
      <Badge dot={hasError} status="error" offset={[-2, 2]}>
        <Button
          type="text"
          shape="circle"
          aria-label={tooltipTitle}
          icon={
            isSaving ? (
              <SyncOutlined spin style={{ color: token.colorTextSecondary }} />
            ) : (
              <DropboxOutlined
                style={{
                  color: hasError ? token.colorError : token.colorTextSecondary,
                }}
              />
            )
          }
          onClick={() => navigate('/settings?tab=storage')}
        />
      </Badge>
    </Tooltip>
  );
}

export default DropboxStorageIndicator;
