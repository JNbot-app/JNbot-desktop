import { useEffect, useState } from 'react';
import { Button, Input, Space, Tag, Typography, theme } from 'antd';
import useAppApi from '../../hooks/useAppApi';
import OwnedShareList from '../share/OwnedShareList';

const PublisherIdentity = () => {
  const { message } = useAppApi();
  const { token } = theme.useToken();
  const [name, setName] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [loading, setLoading] = useState(true);
  const [trusted, setTrusted] = useState<
    Array<{
      fingerprint: string;
      localLabel: string;
      firstSeenName: string;
      builtIn: boolean;
    }>
  >([]);

  useEffect(() => {
    void Promise.all([
      window.ipcRenderer.get('GET_PUBLISHER_IDENTITY'),
      window.ipcRenderer.get('GET_TRUSTED_PUBLISHERS'),
    ]).then(([result, publishers]) => {
      if (result.status === 'success') {
        setName(result.name ?? '');
        setFingerprint(result.fingerprint ?? '');
      } else message.error(result.message);
      setTrusted(publishers);
      setLoading(false);
    });
  }, [message]);

  const save = async () => {
    const result = await window.ipcRenderer.get('SET_PUBLISHER_NAME', name);
    if (result.status === 'success') {
      setFingerprint(result.fingerprint ?? '');
      message.success('Publisher identity updated');
    } else message.error(result.message);
  };

  const removeTrusted = async (publisherFingerprint: string) => {
    await window.ipcRenderer.get(
      'REMOVE_TRUSTED_PUBLISHER',
      publisherFingerprint,
    );
    setTrusted((current) =>
      current.filter((entry) => entry.fingerprint !== publisherFingerprint),
    );
    message.success('Publisher trust removed');
  };

  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Space.Compact style={{ width: '100%' }}>
        <Input
          value={name}
          maxLength={100}
          placeholder="Publisher name"
          disabled={loading}
          onChange={(event) => setName(event.target.value)}
          onPressEnter={save}
        />
        <Button type="primary" loading={loading} onClick={save}>
          Save
        </Button>
      </Space.Compact>
      {fingerprint && (
        <Typography.Text type="secondary" copyable={{ text: fingerprint }}>
          Fingerprint: {fingerprint.match(/.{1,4}/g)?.join(' ')}
        </Typography.Text>
      )}
      {trusted.length > 0 && (
        <Space orientation="vertical" size="small" style={{ width: '100%' }}>
          <Typography.Text strong>Trusted publishers</Typography.Text>
          {trusted.map((publisher) => (
            <div
              key={publisher.fingerprint}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: token.marginSM,
                padding: `${token.paddingXS}px ${token.paddingSM}px`,
                border: `${token.lineWidth}px ${token.lineType} ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadius,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <Space size="small">
                  <Typography.Text>{publisher.localLabel}</Typography.Text>
                  {publisher.builtIn && <Tag color="success">Built in</Tag>}
                </Space>
                <Typography.Text
                  type="secondary"
                  copyable={{ text: publisher.fingerprint }}
                  style={{ display: 'block', wordBreak: 'break-all' }}
                >
                  {publisher.fingerprint.match(/.{1,4}/g)?.join(' ')}
                </Typography.Text>
              </div>
              {!publisher.builtIn && (
                <Button
                  size="small"
                  danger
                  onClick={() => removeTrusted(publisher.fingerprint)}
                >
                  Remove trust
                </Button>
              )}
            </div>
          ))}
        </Space>
      )}
      <OwnedShareList />
    </Space>
  );
};

export default PublisherIdentity;
