import React from 'react';
import { Typography, theme as antTheme } from 'antd';
import BotVitals from '../BotVitals';
import { BotInfo } from '../types';
import useBotInfo from '../useBotInfo';

interface InfoProps {
  selectedBot: BotInfo;
  small?: boolean;
}

const Field: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div style={{ minWidth: 0 }}>
    <Typography.Text
      type="secondary"
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        display: 'block',
        marginBottom: 4,
      }}
    >
      {label}
    </Typography.Text>
    <Typography.Text
      style={{
        fontSize: 13,
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        wordBreak: 'break-all',
      }}
    >
      {value || '/'}
    </Typography.Text>
  </div>
);

const Info: React.FC<InfoProps> = ({ selectedBot, small }) => {
  const info = useBotInfo(selectedBot.botId);
  const { token } = antTheme.useToken();

  const fields: { label: string; value?: React.ReactNode }[] = [
    { label: 'Script', value: selectedBot.SCRIPT_NAME },
    { label: 'Script ID', value: selectedBot.SCRIPT_ID },
    { label: 'Bot ID', value: selectedBot.botId },
    {
      label: 'UUID',
      value: selectedBot.UID ?? info.uuid,
    },
    { label: 'Version', value: selectedBot.version },
    { label: 'Host', value: selectedBot.host },
    { label: 'Gamemode', value: info.gamemode },
    {
      label: 'Position',
      value: info.position
        ? `${info.position.x}, ${info.position.y}, ${info.position.z}`
        : undefined,
    },
    { label: 'Ping', value: info.ping !== undefined ? `${info.ping} ms` : undefined },
  ];

  return (
    <div
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 12,
        padding: small ? 16 : '20px 24px',
        background: token.colorBgElevated,
      }}
    >
      <BotVitals info={info} />
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          marginBottom: 20,
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
          Identity
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {fields.length} fields
        </Typography.Text>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: small ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, 1fr)',
          rowGap: small ? 14 : 20,
          columnGap: 24,
        }}
      >
        {fields.map((f) => (
          <Field key={f.label} label={f.label} value={f.value} />
        ))}
      </div>
    </div>
  );
};

export default Info;
