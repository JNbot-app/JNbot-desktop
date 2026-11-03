import { useEffect, useState } from 'react';
import { Alert, Empty, Flex, Input, Skeleton, theme } from 'antd';
import { CodeOutlined } from '@ant-design/icons';
import type { MinecraftServerSummary } from '../../../common/minecraftServers';
import useAppApi from '../../hooks/useAppApi';

interface ServerConsoleProps {
  server: MinecraftServerSummary;
}

const ServerConsole = ({ server }: ServerConsoleProps) => {
  const { message } = useAppApi();
  const [command, setCommand] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const { token } = theme.useToken();
  const serverId = server.id;
  const canSendCommand =
    server.role === 'host' && server.source === 'dedicated';

  useEffect(() => {
    let active = true;
    setLines([]);
    setLoadError(undefined);
    setLoading(true);

    const disposeLog = window.ipcRenderer.on(
      'MC_SERVER_LOG',
      ({ id, line }: { id: string; line: string }) => {
        if (id !== serverId) return;
        setLines((current) => [...current.slice(-1998), line]);
      },
    );

    const loadInitialLines = async () => {
      try {
        const initialLines = (await window.ipcRenderer.get(
          'MC_SERVER_CONSOLE_LINES',
          { id: serverId },
        )) as string[];
        if (active) {
          setLines((current) => [...initialLines, ...current].slice(-2000));
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadInitialLines().catch((error: unknown) => {
      if (active) {
        setLoadError(error instanceof Error ? error.message : String(error));
        message.error(error instanceof Error ? error.message : String(error));
      }
      return undefined;
    });

    return () => {
      active = false;
      disposeLog?.();
    };
  }, [serverId, message]);

  const send = async () => {
    if (!command.trim()) return;
    try {
      await window.ipcRenderer.get('MC_SERVER_CONSOLE_COMMAND', {
        id: server.id,
        command: command.trim(),
      });
      setCommand('');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Flex vertical gap="middle" style={{ height: '100%' }}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: token.paddingMD,
          background: token.colorBgLayout,
          borderRadius: token.borderRadius,
          border: `${token.lineWidth}px solid ${token.colorBorderSecondary}`,
        }}
      >
        {loading ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : loadError ? (
          <Alert
            type="error"
            showIcon
            title="Console output could not be loaded"
            description={loadError}
          />
        ) : lines.length ? (
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              fontFamily: token.fontFamilyCode,
              color: token.colorText,
            }}
          >
            {lines.join('\n')}
          </pre>
        ) : (
          <Empty
            image={
              <CodeOutlined style={{ fontSize: token.fontSizeHeading2 }} />
            }
            description="No output yet"
          />
        )}
      </div>
      {canSendCommand && (
        <Input.Search
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onSearch={send}
          enterButton="Send"
          maxLength={4096}
          placeholder={
            server.state === 'online'
              ? 'Enter a server command'
              : 'Start the server to send commands'
          }
          disabled={server.state !== 'online'}
        />
      )}
    </Flex>
  );
};

export default ServerConsole;
