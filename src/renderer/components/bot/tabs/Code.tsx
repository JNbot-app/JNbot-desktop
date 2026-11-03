import '../../codeEditor/monaco';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button, Space, Typography, Tooltip } from 'antd';
import { PlayCircleOutlined, ClearOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { BotInfo } from '../types';
import useApp from '../../../hooks/useApp';
import ConsoleLog, { ConsoleLogRef } from '../../../windows/console/ConsoleLog';
import botEvents from '../../../utils/botEvents';
// @ts-ignore
import autoCompleteText from '../../../assets/autoComplete/botTypes.txt?raw';

interface CodeProps {
  selectedBot: BotInfo;
  small?: boolean;
}


const storageKey = `bot_code_tab`;
const Code: React.FC<CodeProps> = ({ selectedBot, small }) => {
  const [code, setCode] = useState<string>(
    '// Write your JavaScript code here\n// Example:\nconsole.log("Hello from bot:", bot.username);\n',
  );
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const terminalRef = useRef<ConsoleLogRef>(null);
  const codeRef = useRef<string>(code);
  const libRef = useRef<{ dispose(): void } | null>(null);

  const { theme } = useApp();

  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  useEffect(() => {
    if (!selectedBot.botId) return;
    const savedCode = localStorage.getItem(storageKey);
    if (savedCode) {
      setCode(savedCode);
    } else {
      setCode(
        '// Write your JavaScript code here\n// Example:\nconsole.log("Hello from bot:", bot.username);\n',
      );
    }

    const unsub = botEvents.subscribe(
      selectedBot.botId,
      'codeLogs',
      (data) => {
        terminalRef.current?.addString(data);
      },
      {
        throttle: 200,
      },
    );
    
    return () => {
      const code = codeRef.current || '';
      localStorage.setItem(storageKey, code);
      unsub();
    };
  }, [selectedBot?.botId]);

  const handleEditorDidMount = useCallback((_editor: any, monaco: any) => {
    libRef.current?.dispose();
    libRef.current = monaco.languages.typescript.javascriptDefaults.addExtraLib(
      autoCompleteText,
      'BotCodeAutoComplete.d.ts',
    );
  }, []);

  // Remove the bot typings so they don't leak into the plugin editor.
  useEffect(() => () => libRef.current?.dispose(), []);

  const handleCodeChange = useCallback((value: string | undefined) => {
    const newCode = value ?? '';
    setCode(newCode);
  }, []);

  const runCode = async () => {
    if (!selectedBot || !code.trim()) return;

    setIsRunning(true);

    try {
      await botEvents.actionAsync(selectedBot.botId, 'runCode', code);
    } finally {
      setIsRunning(false);
    }
  };

  const clearConsole = () => {
    terminalRef.current?.set([]);
  };

  if (small) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: '8px' }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Tooltip title="Run code">
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={runCode}
                loading={isRunning}
                size="small"
              >
                Run
              </Button>
            </Tooltip>
            <Tooltip title="Clear console">
              <Button
                type="text"
                size="small"
                icon={<ClearOutlined />}
                onClick={clearConsole}
              >
                Clear
              </Button>
            </Tooltip>
          </Space>
        </div>

        <div
          style={{
            flexGrow: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div
            style={{
              height: '300px',
              border: '1px solid rgba(0, 0, 0, 0.15)',
              borderRadius: '4px',
              overflow: 'hidden',
            }}
          >
            <Editor
              height="100%"
              language="javascript"
              value={code}
              onChange={handleCodeChange}
              onMount={handleEditorDidMount}
              theme={theme === 'light' ? 'light' : 'vs-dark'}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: 'off',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
              }}
            />
          </div>

          <div
            style={{
              height: '300px',
              border: '1px solid rgba(0, 0, 0, 0.15)',
              borderRadius: '4px',
              overflow: 'hidden',
              backgroundColor: theme === 'light' ? '#fff' : '#1e1e1e',
            }}
          >
            <div
              style={{
                padding: '4px 8px',
                borderBottom: '1px solid rgba(0, 0, 0, 0.15)',
              }}
            >
              <Typography.Text strong style={{ fontSize: '12px' }}>
                Console
              </Typography.Text>
            </div>
            <div
              style={{
                height: 'calc(100% - 32px)',
                overflow: 'auto',
                padding: '8px',
                fontFamily: 'monospace',
                fontSize: '11px',
              }}
            >
              <ConsoleLog ref={terminalRef}  />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '0 0 12px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Typography.Text
          strong
          style={{
            fontSize: 11,
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          Editor
        </Typography.Text>
        <Space>
          <Tooltip title="Clear console">
            <Button type="text" icon={<ClearOutlined />} onClick={clearConsole}>
              Clear
            </Button>
          </Tooltip>
          <Tooltip title="Run code">
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={runCode}
              loading={isRunning}
            >
              Run
            </Button>
          </Tooltip>
        </Space>
      </div>

      <div style={{ flexGrow: 1, overflow: 'hidden' }}>
        <PanelGroup direction="vertical">
          <Panel defaultSize={60} minSize={30} id="editor-panel" order={1}>
            <Editor
              height="100%"
              language="javascript"
              value={code}
              onChange={handleCodeChange}
              onMount={handleEditorDidMount}
              theme={theme === 'light' ? 'light' : 'vs-dark'}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                renderWhitespace: 'none',
              }}
            />
          </Panel>

          <PanelResizeHandle
            style={{
              height: '4px',
              backgroundColor: 'rgba(0, 0, 0, 0.1)',
              cursor: 'row-resize',
            }}
          />

          <Panel defaultSize={40} minSize={20} id="console-panel" order={2}>
            <div
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: theme === 'light' ? '#fff' : '#1e1e1e',
              }}
            >
              <div
                style={{
                  padding: '8px 16px',
                  borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
                }}
              >
                <Typography.Text strong>Console Output</Typography.Text>
              </div>
              <div
                style={{
                  flexGrow: 1,
                  overflow: 'auto',
                  padding: '8px 16px',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                }}
              >
                <ConsoleLog ref={terminalRef} />
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
};

export default Code;
