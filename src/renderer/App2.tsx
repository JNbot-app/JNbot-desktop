import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Router from './routing/Router';
import Messager from './messager';
import ErrorPage from './pages/ErrorPage';
import FileDropOverlay from './components/other/FileDropOverlay';
import * as Sentry from '@sentry/react';
import useAppApi from './hooks/useAppApi';
import { Button, Spin, Typography } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

const App = () => {
  const { snackbar } = useAppApi();
  const [isDragOver, setIsDragOver] = useState(false);
  const [storageStartupError, setStorageStartupError] = useState('');
  const [storageBusy, setStorageBusy] = useState(false);
  const lastWriteError = useRef('');

  useEffect(() => {
    if (window.web) return;
    const stopStartup = window.ipcRenderer.on('storage:startup-error', setStorageStartupError);
    const stopWrites = window.ipcRenderer.on('storage:write-status', (status: { lastError?: string }) => {
      if (status.lastError && status.lastError !== lastWriteError.current) {
        snackbar.error({ message: status.lastError });
      }
      lastWriteError.current = status.lastError ?? '';
    });
    void window.ipcRenderer.invoke<{ startupError?: string; writes?: { lastError?: string } }>('storage:status')
      .then((status) => {
        setStorageStartupError(status.startupError ?? '');
        if (status.writes?.lastError) {
          lastWriteError.current = status.writes.lastError;
          snackbar.error({ message: status.writes.lastError });
        }
      })
      .catch((error) => setStorageStartupError(String(error)));
    return () => { stopStartup?.(); stopWrites?.(); };
  }, [snackbar]);

  const [connectState, setConnectState] = useState(
    window.web ? 'Connecting...' : 'connected',
  );

  useEffect(() => {
    if (window.web) {
      window.ipcRenderer.setSnackbar &&
        window.ipcRenderer.setSnackbar(snackbar);


      window.ipcRenderer.setLoadingScreen &&
        window.ipcRenderer.setLoadingScreen((state) => {
          console.log('Set loading state to ', state);
          setConnectState(state);
        });

        
    }

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.dataTransfer?.types.includes('Files')) {
        e.dataTransfer.dropEffect = 'copy';
        setIsDragOver(true);
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer?.files || []);
      const jnbotFiles = files.filter((file) => file.name.endsWith('.jnp'));

      if (jnbotFiles.length > 0) {
        for (const file of jnbotFiles) {
          // Electron removed `File.path`; resolve the absolute path through
          // the preload's webUtils bridge instead.
          const filePath = window.ipcRenderer?.getPathForFile?.(file);
          if (!window.web && !filePath) {
            snackbar.error({ message: `Could not read ${file.name}` });
            continue;
          }
          try {
            const result = window.web
              ? await window.ipcRenderer.get('IMPORT_MACRO_FILE', { content: await file.text() })
              : await window.ipcRenderer.get('IMPORT_MACRO_FILE', filePath);

            if (result.status === 'success') {
              snackbar.success({ message: result.message });
            } else {
              snackbar.error({
                message: result.message || 'Failed to import plugin',
              });
            }
          } catch (error) {
            console.error('Error importing plugin:', error);
            snackbar.error({ message: `Failed to import ${file.name}` });
          }
        }
      }
    };

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer?.types.includes('Files')) {
        setIsDragOver(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Only reset if we're leaving the window (not moving between child elements)
      if (
        e.relatedTarget === null ||
        !document.contains(e.relatedTarget as Node)
      ) {
        setIsDragOver(false);
      }
    };

    // Add event listeners to document
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);

    // Cleanup function
    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
    };
  }, [snackbar]);

  useLayoutEffect(() => {
    if (window.web)
      setTimeout(() => {
        if (!window.ipcRenderer.connect || window.ipcRenderer.webRTC) return;
        console.log('Starting connection...');
        window.ipcRenderer.connect();
      }, 250);
  }, []);

  const onError = (err: any, info: any) => {
    // Log the full error to the console first. Sentry is frequently blocked by
    // adblockers (net::ERR_BLOCKED_BY_CLIENT), so we must never rely on it to
    // surface what actually went wrong.
    console.error('[UI ErrorBoundary] Caught render error:', err);
    if (err?.stack) console.error(err.stack);
    if (info?.componentStack)
      console.error('Component stack:', info.componentStack);

    try {
      window.ipcRenderer.action('ERROR', {
        error: err?.name + ' ' + err?.message,
        stack: err?.stack ?? info?.componentStack,
      });
    } catch {}
    const eventId = Sentry.captureMessage(`UI error report`);
    Sentry.showReportDialog({
      eventId,
      title: 'Woops! Something went wrong...',
      subtitle: 'Help me fix the issue! Tell me what happened.',
      subtitle2: `If not, just click 'close' below.`,
      labelComments: 'Explain what you did to trigger this issue',
      labelSubmit: 'Submit report',
      onClose: () => {
        window.history.back();
      },
    });
  };

  if (storageStartupError) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: 520, padding: 24 }}>
          <Typography.Title level={3}>Dropbox storage unavailable</Typography.Title>
          <Typography.Paragraph>{storageStartupError}</Typography.Paragraph>
          <Button loading={storageBusy} onClick={() => void window.ipcRenderer.invoke('storage:retry')}>Retry</Button>{' '}
          <Button loading={storageBusy} onClick={() => {
            setStorageBusy(true);
            void window.ipcRenderer.invoke('storage:select', 'local').catch((error) => {
              setStorageStartupError(String(error));
              setStorageBusy(false);
            });
          }}>Use Local</Button>
        </div>
      </div>
    );
  }

  if (connectState !== 'connected') {
    return (
      <Sentry.ErrorBoundary fallback={ErrorPage} showDialog onError={onError}>
        <div
          style={{
            width: '100%',
            height: '100vh',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <Spin
              indicator={<LoadingOutlined style={{ fontSize: 48 }} spin />}
            />
            <br />
            <br />
            <Typography.Text strong style={{ fontSize: '1.3em' }}>
              {connectState}
            </Typography.Text>
            {connectState === 'Disconnected' && (
              <>
                <br />
                <Button
                  onClick={() => window.location.reload()}
                  style={{ marginTop: '1rem' }}
                >
                  Reconnect
                </Button>
              </>
            )}
          </div>
        </div>
      </Sentry.ErrorBoundary>
    );
  }
  return (
    <Sentry.ErrorBoundary fallback={ErrorPage} onError={onError}>
      <div
        style={{
          position: 'relative',
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        {isDragOver && <FileDropOverlay />}

        <Messager />
        <Router />
      </div>
    </Sentry.ErrorBoundary>
  );
};

export default App;
