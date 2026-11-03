import { useEffect, useRef, useState } from 'react';
import { Button, Input, Space } from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import ConsoleLog, { ConsoleLogRef } from 'renderer/windows/console/ConsoleLog';
import useAppApi from 'renderer/hooks/useAppApi';
import { FullLogMessage } from 'main/src/types';

const LogsTab = () => {
  const consoleBoxRef = useRef<ConsoleLogRef>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const app = useAppApi();

  useEffect(() => {
    window.ipcRenderer.get('GET_LOGS').then((data) => {
      consoleBoxRef.current?.set(data.logs);
    });

    const removeAppendMessages = window.ipcRenderer.on(
      'LOGS',
      (data: FullLogMessage[]) => {
        consoleBoxRef.current?.addLogs(data);
      },
    );

    return () => {
      removeAppendMessages();
    };
  }, []);

  const clear = () => {
    consoleBoxRef.current?.clearConsole();
  };

  const copyLogs = async () => {
    if (!consoleBoxRef.current?.copy) {
      app.message.error('Unable to copy logs');
      return;
    }
    try {
      await consoleBoxRef.current.copy();
      app.message.success('Logs copied to clipboard');
    } catch (e) {
      app.message.error('Unable to copy logs');
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        height: '100%',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <Input
          aria-label="Search logs"
          placeholder="Search messages or scripts"
          prefix={<SearchOutlined />}
          allowClear
          size="small"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          style={{ flex: '1 1 180px', minWidth: 0 }}
        />
        <Space size={4}>
          <Button size="small" icon={<DeleteOutlined />} onClick={clear}>
            Clear
          </Button>
          <Button size="small" icon={<CopyOutlined />} onClick={copyLogs}>
            Copy
          </Button>
        </Space>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          borderRadius: 8,
          border: '1px solid rgba(128,128,128,0.18)',
          background: 'rgba(0,0,0,0.15)',
          padding: 8,
          overflow: 'hidden',
        }}
      >
        <ConsoleLog ref={consoleBoxRef} searchQuery={searchQuery} />
      </div>
    </div>
  );
};

export default LogsTab;
