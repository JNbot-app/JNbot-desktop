import '../codeEditor/monaco';
import React from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { Button, Flex, Tag, Tooltip, Typography, theme } from 'antd';
import { CheckOutlined, CopyOutlined } from '@ant-design/icons';
import useApp from '../../hooks/useApp';
import { Themes } from '../../../common/CommonEnums';

const { Text } = Typography;

interface McpCodeViewerProps {
  code?: string;
  diff?: {
    before?: string;
    after: string;
  };
  language?: string;
  height?: number | string;
  title?: string;
}

const McpCodeViewer: React.FC<McpCodeViewerProps> = ({
  code,
  diff,
  language = 'javascript',
  height = 280,
  title,
}) => {
  const { token } = theme.useToken();
  const { theme: appTheme } = useApp();
  const [copied, setCopied] = React.useState(false);

  const editorTheme = appTheme === Themes.LIGHT ? 'light' : 'vs-dark';

  const contentToCopy = diff ? diff.after : code ?? '';

  const handleCopy = async () => {
    if (!contentToCopy) return;
    await navigator.clipboard.writeText(contentToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const options = {
    readOnly: true,
    domReadOnly: true,
    minimap: { enabled: false },
    renderSideBySide: Boolean(diff?.before),
    scrollBeyondLastLine: false,
    wordWrap: 'on' as const,
    fontSize: 13,
    lineNumbersMinChars: 3,
    padding: { top: 8, bottom: 8 },
  };

  return (
    <div
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        overflow: 'hidden',
        background: token.colorBgContainer,
      }}
    >
      <Flex
        justify="space-between"
        align="center"
        style={{
          padding: '6px 12px',
          background: token.colorFillAlter,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Flex align="center" gap={8}>
          {title && <Text strong style={{ fontSize: 12 }}>{title}</Text>}
          <Tag variant="filled" style={{ margin: 0, textTransform: 'uppercase', fontSize: 11 }}>
            {diff?.before ? 'Diff / Review' : language}
          </Tag>
        </Flex>
        {contentToCopy && (
          <Tooltip title={copied ? 'Copied' : 'Copy code'}>
            <Button
              type="text"
              size="small"
              icon={copied ? <CheckOutlined /> : <CopyOutlined />}
              onClick={handleCopy}
            />
          </Tooltip>
        )}
      </Flex>
      <div style={{ height, width: '100%' }}>
        {diff ? (
          <DiffEditor
            original={diff.before ?? ''}
            modified={diff.after}
            language={language}
            theme={editorTheme}
            options={options}
          />
        ) : (
          <Editor
            value={code ?? ''}
            language={language}
            theme={editorTheme}
            options={options}
          />
        )}
      </div>
    </div>
  );
};

export default McpCodeViewer;
