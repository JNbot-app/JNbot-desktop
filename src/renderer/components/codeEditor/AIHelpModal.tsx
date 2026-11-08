import React, { useState } from 'react';
import { Button, Modal, Typography, theme } from 'antd';
import { CheckOutlined, CopyOutlined, RobotOutlined } from '@ant-design/icons';
import useAppApi from '../../hooks/useAppApi';
import { useNavigate } from 'react-router-dom';

const { Paragraph, Text, Title } = Typography;

const CONTEXT_INDEX_URL = 'https://jnbot.netlify.app/llm.txt';
const AI_CONTEXT_PROMPT = `Start by reading the JNbot context index at:

${CONTEXT_INDEX_URL}

It lists the current JNbot reference files. Always read the plugin authoring guide, then the API files the task needs (or the single all-in-one file if you cannot open several links). Treat them as the source of truth for the available APIs, types, runtime constraints, and examples. Base your solution on them, do not invent unsupported methods, and tell me clearly if you cannot access them. Then answer the JNbot request I include with this instruction.`;

interface AIHelpModalProps {
  visible: boolean;
  onClose: () => void;
}

const AIHelpModal: React.FC<AIHelpModalProps> = ({ visible, onClose }) => {
  const [copySuccess, setCopySuccess] = useState(false);
  const { message } = useAppApi();
  const navigate = useNavigate();
  const { token } = theme.useToken();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(AI_CONTEXT_PROMPT);
      setCopySuccess(true);
      message.success('AI context copied');
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      message.error('Could not copy the AI context');
    }
  };

  const handleClose = () => {
    setCopySuccess(false);
    onClose();
  };

  return (
    <Modal
      open={visible}
      onCancel={handleClose}
      width={680}
      centered
      title={null}
      footer={null}
      styles={{
        container: {
          padding: 0,
          overflow: 'hidden',
          borderRadius: token.borderRadiusLG,
        },
        body: { padding: 0 },
      }}
    >
      <div
        style={{
          padding: '30px 32px 28px',
          color: '#fff',
          background:
            'linear-gradient(135deg, #252b65 0%, #4b3ca7 52%, #6d4bd1 100%)',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '5px 10px',
            marginBottom: 18,
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.1)',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          <RobotOutlined />
          AI coding setup
        </div>
        <Title
          level={2}
          style={{ margin: '0 0 8px', color: '#fff', fontSize: 27 }}
        >
          Give your AI the JNbot API
        </Title>
        <Paragraph
          style={{
            maxWidth: 560,
            margin: 0,
            color: 'rgba(255,255,255,0.78)',
            fontSize: 15,
            lineHeight: 1.6,
          }}
        >
          Copy the instruction below and paste it together with your question in
          ChatGPT, Claude, or another LLM.
        </Paragraph>
      </div>

      <div style={{ padding: '28px 32px 32px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 32px 1fr',
            alignItems: 'center',
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 30,
                height: 30,
                flex: '0 0 30px',
                borderRadius: '50%',
                color: token.colorPrimary,
                background: token.colorPrimaryBg,
                fontWeight: 700,
              }}
            >
              1
            </div>
            <div>
              <Text strong>Copy the context</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                One click, no download
              </Text>
            </div>
          </div>

          <div
            style={{
              height: 1,
              margin: '0 8px',
              background: token.colorBorderSecondary,
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 30,
                height: 30,
                flex: '0 0 30px',
                borderRadius: '50%',
                color: token.colorPrimary,
                background: token.colorPrimaryBg,
                fontWeight: 700,
              }}
            >
              2
            </div>
            <div>
              <Text strong>Add your own prompt</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Paste both in one prompt
              </Text>
            </div>
          </div>
        </div>

        <div
          style={{
            overflow: 'hidden',
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
            background: token.colorFillAlter,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              padding: '11px 16px',
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
            }}
          >
            <Text
              strong
              style={{
                fontSize: 12,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              Paste this with your prompt
            </Text>
          </div>
          <Paragraph
            copyable={{ text: AI_CONTEXT_PROMPT, tooltips: false }}
            style={{
              margin: 0,
              padding: '16px 18px',
              color: token.colorTextSecondary,
              fontSize: 13,
              lineHeight: 1.65,
              whiteSpace: 'pre-wrap',
            }}
          >
            {AI_CONTEXT_PROMPT}
          </Paragraph>
        </div>

        <div
          style={{
            marginTop: 18,
            padding: '12px 14px',
            borderRadius: token.borderRadius,
            color: token.colorTextSecondary,
            background: token.colorPrimaryBg,
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          <Text strong>Then add what you need.</Text> For example: “Create a
          script that follows the nearest player and stops when they leave.”
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 24,
          }}
        >
          <Button
            type="link"
            size="large"
            icon={<RobotOutlined />}
            onClick={() => {
              handleClose();
              navigate('/mcp');
            }}
            style={{ marginRight: 'auto' }}
          >
            Open MCP
          </Button>
          <Button size="large" onClick={handleClose}>
            Close
          </Button>
          <Button
            type="primary"
            size="large"
            icon={copySuccess ? <CheckOutlined /> : <CopyOutlined />}
            onClick={handleCopy}
            style={{ minWidth: 190, fontWeight: 600 }}
          >
            {copySuccess ? 'Copied to clipboard' : 'Copy AI context'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default AIHelpModal;
