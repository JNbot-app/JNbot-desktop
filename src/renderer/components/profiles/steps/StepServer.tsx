import { Avatar, Button, ColorPicker, Flex, Form, Input, Switch, Typography, theme } from 'antd';
import { CloseOutlined, DeleteOutlined, DownOutlined, PlusOutlined, UpOutlined } from '@ant-design/icons';
import { useRef, useState } from 'react';
import type { CustomProfile } from '../../../../common/profiles';
import { withAlpha } from '../../intro/introUtils';
import SectionHeader from '../SectionHeader';
import ServerAddressField from '../ServerAddressField';
import { BRAND_COLORS, guessServerName, iconColor, initialsOf } from '../wizardUtils';

const { Text } = Typography;

type Data = CustomProfile['data'];

export interface ServerErrors {
  name?: string;
  address?: string;
}

interface Props {
  data: Data;
  onChange: (patch: Partial<Data>) => void;
  errors: ServerErrors;
  /** New profiles take their name, icon and colour from the server until the user picks their own. */
  autofill: boolean;
}

const COLOR_PRESETS = [{ label: 'Suggested', colors: [...BRAND_COLORS] }];

const StepServer = ({ data, onChange, errors, autofill }: Props) => {
  const { token } = theme.useToken();
  const [more, setMore] = useState(!!data.ips?.length);
  const auto = useRef({
    name: !data.name,
    icon: !data.icon,
    color: autofill && !data.icon,
  });
  const icon = data.icon ?? '';
  const serverIcon = icon.startsWith('data:');
  const ips = data.ips ?? [];

  const fillFromServer = (favicon?: string) => {
    if (auto.current.name) onChange({ name: guessServerName(data.defaultIp) });
    if (!favicon || !auto.current.icon) return;
    onChange({ icon: favicon });
    if (auto.current.color)
      void iconColor(favicon).then((color) => color && auto.current.color && onChange({ color }));
  };

  const setIps = (next: string[]) => onChange({ ips: next });

  return (
    <div>
      <SectionHeader title="Server">Where your bots connect.</SectionHeader>

      <Form layout="vertical" requiredMark={false} style={{ maxWidth: 520 }}>
        <ServerAddressField
          host={data.defaultIp ?? ''}
          port={data.defaultPort ?? 25565}
          error={errors.address}
          autoFocus={!data.defaultIp}
          onChange={(defaultIp, defaultPort) => onChange({ defaultIp, defaultPort })}
          onOnline={(status) => fillFromServer(status.favicon)}
        />

        <Form.Item
          label="Name"
          required
          validateStatus={errors.name ? 'error' : undefined}
          help={errors.name}
        >
          <Input
            value={data.name}
            placeholder="My server"
            maxLength={48}
            autoComplete="off"
            onChange={(e) => {
              auto.current.name = false;
              onChange({ name: e.target.value });
            }}
          />
        </Form.Item>

        <Flex
          justify="space-between"
          align="center"
          gap={token.margin}
          style={{ marginBottom: token.marginLG }}
        >
          <div>
            <Text>Premium server</Text>
            <br />
            <Text type="secondary">Only paid Minecraft accounts can join</Text>
          </div>
          <Switch
            checked={data.onlineMode === true}
            onChange={(onlineMode) => onChange({ onlineMode })}
          />
        </Flex>

        <Form.Item label="Look">
          <Flex gap={token.marginSM} align="center">
            <Avatar
              shape="square"
              size={32}
              src={icon || undefined}
              style={{
                flexShrink: 0,
                background: withAlpha(data.color, 0.25),
                color: data.color,
                fontWeight: 600,
              }}
            >
              {initialsOf(data.name || '?')}
            </Avatar>
            <Input
              value={serverIcon ? '' : icon}
              placeholder={serverIcon ? "Using the server's icon" : 'Icon URL'}
              autoComplete="off"
              suffix={
                serverIcon && (
                  <CloseOutlined
                    aria-label="Remove icon"
                    style={{ color: token.colorTextTertiary }}
                    onClick={() => {
                      auto.current.icon = false;
                      onChange({ icon: null });
                    }}
                  />
                )
              }
              onChange={(e) => {
                auto.current.icon = false;
                onChange({ icon: e.target.value || null });
              }}
            />
            <ColorPicker
              value={data.color}
              presets={COLOR_PRESETS}
              onChangeComplete={(c) => {
                auto.current.color = false;
                onChange({ color: c.toHexString().toUpperCase() });
              }}
            />
          </Flex>
        </Form.Item>

        <Button
          type="link"
          icon={more ? <UpOutlined /> : <DownOutlined />}
          iconPlacement="end"
          onClick={() => setMore(!more)}
          style={{ paddingInline: 0 }}
        >
          More options
        </Button>

        {more && (
          <div style={{ marginTop: token.margin }}>
            <Form.Item label="Short name" tooltip="Shown in the server switcher.">
              <Input
                value={data.shortName}
                placeholder={data.name?.slice(0, 12)}
                maxLength={12}
                autoComplete="off"
                style={{ maxWidth: 200 }}
                onChange={(e) => onChange({ shortName: e.target.value })}
              />
            </Form.Item>

            <Form.Item
              label="Other addresses"
              tooltip="Extra addresses for the same server. Bots spread across them."
            >
              <Flex vertical gap={token.marginXS}>
                {ips.map((ip, i) => (
                  <Flex key={i} gap={token.marginXS}>
                    <Input
                      value={ip}
                      placeholder="proxy1.example.net"
                      autoComplete="off"
                      onChange={(e) =>
                        setIps(ips.map((v, j) => (j === i ? e.target.value.trim() : v)))
                      }
                    />
                    <Button
                      type="text"
                      icon={<DeleteOutlined />}
                      aria-label="Remove address"
                      onClick={() => setIps(ips.filter((_, j) => j !== i))}
                    />
                  </Flex>
                ))}
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => setIps([...ips, ''])}
                  style={{ alignSelf: 'flex-start' }}
                >
                  Add address
                </Button>
              </Flex>
            </Form.Item>
          </div>
        )}
      </Form>
    </div>
  );
};

export default StepServer;
