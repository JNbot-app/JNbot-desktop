import React from 'react';
import {
  Button,
  Dropdown,
  Skeleton,
  Space,
  Tooltip,
  Typography,
  theme as antTheme,
} from 'antd';
import {
  LogoutOutlined,
  StopOutlined,
  UnlockOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import { useSettingsStore, selectScripts } from '../../redux/settings';
import Image from '../Image';
import botActionHandler from './botActionHandler';
import { BotInfo } from './types';

interface BotHeaderProps {
  selectedBot: BotInfo;
}

const BotHeader: React.FC<BotHeaderProps> = ({ selectedBot }) => {
  const scripts = useSettingsStore(selectScripts);
  const { token } = antTheme.useToken();


  return (
    <div
      style={{
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr 2.4fr',
          alignItems: 'center',
          gap: 20,
        }}
      >
        <Image
          width={48}
          height={48}
          style={{ borderRadius: 8 }}
          loadingElement={<Skeleton.Avatar active shape="square" size={48} />}
          src={`https://crafthead.net/avatar/${selectedBot.username || 'steve'}?size=128&default=MHF_Steve`}
        />

        <div style={{ minWidth: 0 }}>
          <Dropdown
            menu={{ items: [] }}
            trigger={['click']}
            disabled
            placement="bottomLeft"
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'default',
              }}
            >
              <Typography.Text
                strong
                style={{ fontSize: 18, lineHeight: '22px' }}
              >
                {selectedBot.username}
              </Typography.Text>
            </div>
          </Dropdown>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {selectedBot.SCRIPT_NAME}
              {selectedBot.host ? ` · ${selectedBot.host}` : ''}
            </Typography.Text>
          </div>
        </div>
        
      </div>

      <Space size={8} style={{ marginTop: 16, marginBottom: 8 }} wrap>
        <Button
          danger
          icon={<LogoutOutlined />}
          onClick={() => botActionHandler('leave')}
        >
          Leave
        </Button>
        <Tooltip title="Stop script">
          <Button
            icon={<StopOutlined />}
            onClick={() =>
              scripts.stop(selectedBot.RUNTIME_SCRIPT_ID ?? selectedBot.botId)
            }
          >
            Stop
          </Button>
        </Tooltip>
        <Tooltip title="Enter password">
          <Button
            icon={<UnlockOutlined />}
            onClick={() => botActionHandler('login')}
          >
            Auth
          </Button>
        </Tooltip>
        <Dropdown
          menu={{
            items: [
              {
                key: 'activate',
                label: 'Right-click item',
                onClick: () => botActionHandler('activateItem'),
              },
              {
                key: 'close',
                label: 'Close window',
                onClick: () => botActionHandler('closeWindow'),
              },
            ],
          }}
          placement="bottomRight"
          trigger={['click']}
        >
          <Button icon={<MoreOutlined />} style={{ marginLeft: 'auto' }} />
        </Dropdown>
      </Space>
    </div>
  );
};

export default BotHeader;
