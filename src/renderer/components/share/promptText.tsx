import { Input, Space, Typography } from 'antd';
import type { AppApiContextT } from '../../providers/AppApiProvider';

/** Asks for a short text (report reason, review note); resolves null when cancelled. */
export default function promptText(
  { modal }: Pick<AppApiContextT, 'modal'>,
  options: { title: string; description: string; okText: string; placeholder: string; danger?: boolean },
): Promise<string | null> {
  let text = '';
  return new Promise((resolve) => {
    modal.confirm({
      title: options.title,
      icon: null,
      content: (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">{options.description}</Typography.Text>
          <Input.TextArea
            autoFocus
            maxLength={300}
            showCount
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder={options.placeholder}
            onChange={(event) => {
              text = event.target.value;
            }}
          />
        </Space>
      ),
      okText: options.okText,
      okButtonProps: { danger: options.danger },
      onOk: () => {
        if (!text.trim()) return Promise.reject(new Error('empty'));
        resolve(text.trim());
        return undefined;
      },
      onCancel: () => resolve(null),
    });
  });
}
