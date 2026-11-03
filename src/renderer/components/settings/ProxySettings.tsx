import React, { useMemo, useState } from 'react';
import { Alert, Button, Input, List, Space, Switch, Tag, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

export interface ProxyConfig {
  enabled: boolean;
  urls: string[];
}

interface ProxySettingsProps {
  changeSetting: (setting: { key: string; value: ProxyConfig }) => void;
  value: ProxyConfig | ({ enabled?: boolean; url?: string } & Partial<ProxyConfig>) | undefined;
  setting: { key: string };
}

const PROTO_RE = /^([a-z][a-z0-9+.-]*):\/\//i;
const SUPPORTED = ['socks5', 'socks4'] as const;

function detectProtocol(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  const proto = (raw.match(PROTO_RE)?.[1] ?? 'socks5').toLowerCase();
  if (proto === 'socks' || proto === 'socks5h') return 'socks5';
  if (proto === 'socks4a') return 'socks4';
  return SUPPORTED.includes(proto as (typeof SUPPORTED)[number]) ? proto : null;
}

function validateProxyUrl(url: string): { ok: boolean; message?: string } {
  const raw = url.trim();
  if (!raw) return { ok: false, message: 'Proxy URL is empty.' };
  const proto = detectProtocol(raw);
  if (!proto)
    return {
      ok: false,
      message: 'Minecraft uses raw TCP; only SOCKS5 and SOCKS4 proxies are supported.',
    };
  try {
    const parsed = new URL(PROTO_RE.test(raw) ? raw : `socks5://${raw}`);
    return parsed.hostname ? { ok: true } : { ok: false, message: 'Proxy host is missing.' };
  } catch {
    return { ok: false, message: 'Could not parse proxy URL.' };
  }
}

function redactProxyUrl(url: string): string {
  try {
    const parsed = new URL(PROTO_RE.test(url) ? url : `socks5://${url}`);
    if (!parsed.password) return url;
    parsed.password = '••••••';
    return parsed.toString();
  } catch {
    return url;
  }
}

const ProxySettings: React.FC<ProxySettingsProps> = ({ changeSetting, value, setting }) => {
  const current = useMemo<ProxyConfig>(() => {
    const raw = value ?? {};
    const urls = Array.isArray(raw.urls) ? raw.urls : raw.url ? [raw.url] : [];
    return {
      enabled: raw.enabled === true,
      urls: [...new Set(urls.map((url) => url.trim()).filter(Boolean))],
    };
  }, [value]);
  const [draft, setDraft] = useState('');
  const validation = draft ? validateProxyUrl(draft) : { ok: true };
  const normalizedDraft = draft.trim();

  const update = (next: ProxyConfig) => changeSetting({ key: setting.key, value: next });
  const addProxy = () => {
    if (!normalizedDraft || !validation.ok || current.urls.includes(normalizedDraft)) return;
    update({ ...current, urls: [...current.urls, normalizedDraft] });
    setDraft('');
  };

  return (
    <div style={{ minWidth: '30vw', marginRight: '1rem' }}>
      <Space orientation="vertical" style={{ width: '100%' }} size="small">
        <Space>
          <Switch checked={current.enabled} onChange={(enabled) => update({ ...current, enabled })} />
          <Text>{current.enabled ? 'Enabled' : 'Disabled'}</Text>
        </Space>

        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="socks5://user:pass@host:1080"
            value={draft}
            disabled={!current.enabled}
            onChange={(event) => setDraft(event.target.value)}
            onPressEnter={addProxy}
            allowClear
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!current.enabled || !normalizedDraft || !validation.ok || current.urls.includes(normalizedDraft)}
            onClick={addProxy}
          >
            Add
          </Button>
        </Space.Compact>

        <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
          Connections rotate through this list in order. Supported formats: <Text code>socks5://user:pass@host:port</Text> or <Text code>socks4://host:port</Text>.
        </Paragraph>

        {current.enabled && draft && !validation.ok && <Alert type="warning" showIcon title={validation.message} />}
        {current.enabled && current.urls.length === 0 && <Alert type="warning" showIcon title="No proxies configured. Bot joins will fail until one is added." />}

        <List
          size="small"
          locale={{ emptyText: current.enabled ? 'No proxies added yet.' : 'Enable the pool to add proxies.' }}
          dataSource={current.urls}
          renderItem={(url) => {
            const protocol = detectProtocol(url);
            return (
              <List.Item
                key={url}
                actions={[
                  <Button
                    key="remove"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={`Remove ${url}`}
                    onClick={() => update({ ...current, urls: current.urls.filter((item) => item !== url) })}
                  />,
                ]}
              >
                <Space size="small">
                  {protocol && <Tag color="blue">{protocol.toUpperCase()}</Tag>}
                  <Text>{redactProxyUrl(url)}</Text>
                </Space>
              </List.Item>
            );
          }}
        />
      </Space>
    </div>
  );
};

export default ProxySettings;
