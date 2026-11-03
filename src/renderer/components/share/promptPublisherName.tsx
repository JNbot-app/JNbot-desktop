import { Input, Space, Typography } from 'antd';
import type { AppApiContextT } from '../../providers/AppApiProvider';

/**
 * Asks for the publisher name that signs exported plugins, profiles and share
 * links. Resolves true once it is saved.
 */
export default function promptPublisherName(
  { modal, message }: Pick<AppApiContextT, 'modal' | 'message'>,
  fingerprint: string | undefined,
  okText: string,
): Promise<boolean> {
  let publisherName = '';
  return new Promise<boolean>((resolve) => {
    modal.confirm({
      title: 'Set your publisher name',
      content: (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            Others see this name when you share something. Device fingerprint:{' '}
            {fingerprint?.match(/.{1,4}/g)?.join(' ') ?? 'Unavailable'}
          </Typography.Text>
          <Input
            autoFocus
            maxLength={100}
            placeholder="Publisher name"
            onChange={(event) => {
              publisherName = event.target.value;
            }}
          />
        </Space>
      ),
      okText,
      onOk: async () => {
        const saved = await window.ipcRenderer.get('SET_PUBLISHER_NAME', publisherName);
        if (saved.status !== 'success') {
          message.error(saved.message);
          throw new Error(saved.message);
        }
        resolve(true);
      },
      onCancel: () => resolve(false),
    });
  });
}
