import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react';
import { Button, Modal, Divider, Typography, List } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

type ServerStatusData = { ips: string[] };

let serverStatus: ServerStatusData | null = null;

const normalizeStatus = (
  status: ServerStatusData | string[],
): ServerStatusData => ({ ips: Array.isArray(status) ? status : status.ips });

const ServerStatus = forwardRef((_, ref) => {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(serverStatus);
  const [loading, setLoading] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      open: () => setOpen(true),
    }),
    [],
  );

  useEffect(() => {
    const r = window.ipcRenderer.on(
      'SERVER_STATUS',
      (s: ServerStatusData | string[]) => {
        serverStatus = normalizeStatus(s);
        setStatus(serverStatus);
      },
    );

    if (open) {
      window.ipcRenderer
        .get('SERVER_STATUS')
        .then((result) => {
          serverStatus = normalizeStatus(result);
          setStatus(serverStatus);
          return undefined;
        })
        .catch(() => undefined);
    }

    return () => r();
  }, [open]);

  const close = () => setOpen(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const result = await window.ipcRenderer.get('SERVER_STATUS_UPDATE');
      serverStatus = normalizeStatus(result);
      setStatus(serverStatus);
    } finally {
      setLoading(false);
    }
  };

  if (status === null) return null;

  return (
    <Modal
      title="Server status"
      open={open}
      onCancel={close}
      footer={[
        <Button key="close" onClick={close}>
          Close
        </Button>,
        <Button
          key="refresh"
          type="primary"
          loading={loading}
          onClick={refresh}
          icon={<ReloadOutlined />}
        >
          Refresh
        </Button>,
      ]}
      width={500}
    >
      <Divider orientation="horizontal">
        <Typography.Text>Working server IPs</Typography.Text>
      </Divider>
      <List
        dataSource={status?.ips || []}
        renderItem={(ip: string) => (
          <List.Item key={ip}>
            <Typography.Text>{ip}</Typography.Text>
          </List.Item>
        )}
      />
    </Modal>
  );
});

export default ServerStatus;
