import { Badge, Form, Input, Typography } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import type { ServerStatus } from '../../../main/src/functions/minecraft/pingServer';
import { formatAddress, parseAddress } from './wizardUtils';

const { Text } = Typography;

interface Props {
  host: string;
  port: number;
  onChange: (host: string, port: number) => void;
  /** Called once per address the server answered for. */
  onOnline?: (status: ServerStatus) => void;
  error?: string;
  autoFocus?: boolean;
}

type Lookup =
  | { state: 'idle' | 'checking' | 'offline' }
  | { state: 'online'; status: ServerStatus };

/** Address input that accepts "host:port" and pings the server as you type. */
const ServerAddressField = ({ host, port, onChange, onOnline, error, autoFocus }: Props) => {
  // Local text so a half-typed "host:" isn't normalised away mid-edit.
  const [text, setText] = useState(() => formatAddress(host, port));
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  const onOnlineRef = useRef(onOnline);
  onOnlineRef.current = onOnline;

  useEffect(() => {
    if (!host.includes('.') && host !== 'localhost') {
      setLookup({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setLookup({ state: 'checking' });
    const timer = setTimeout(() => {
      window.ipcRenderer
        .get<ServerStatus>('PING_MINECRAFT_SERVER', { host, port })
        .then((status) => {
          if (cancelled) return;
          setLookup({ state: 'online', status });
          onOnlineRef.current?.(status);
        })
        .catch(() => !cancelled && setLookup({ state: 'offline' }));
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [host, port]);

  return (
    <Form.Item
      label="Server address"
      required
      validateStatus={error ? 'error' : undefined}
      help={error}
      extra={<LookupLine lookup={lookup} />}
    >
      <Input
        value={text}
        placeholder="play.example.net"
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        onChange={(e) => {
          setText(e.target.value);
          const next = parseAddress(e.target.value);
          onChange(next.host, next.port);
        }}
      />
    </Form.Item>
  );
};

const LookupLine = ({ lookup }: { lookup: Lookup }) => {
  if (lookup.state === 'checking')
    return (
      <Text type="secondary">
        <LoadingOutlined /> Looking up server…
      </Text>
    );
  if (lookup.state === 'offline')
    return <Badge status="default" text="Couldn't reach this server right now" />;
  if (lookup.state === 'online') {
    const { version, online } = lookup.status;
    const parts = ['Online', version, online !== undefined && `${online.toLocaleString()} playing`];
    return <Badge status="success" text={parts.filter(Boolean).join(' · ')} />;
  }
  return null;
};

export default ServerAddressField;
