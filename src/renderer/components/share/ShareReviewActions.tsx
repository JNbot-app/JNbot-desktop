import { useState } from 'react';
import { Button, Flex, Typography, theme } from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import type { MarketEntry, ShareReviewDecision, SharePreview } from '../../../common/share';
import useAppApi from '../../hooks/useAppApi';
import { useReviewQueue } from './useReviewQueue';
import promptText from './promptText';
import shareRequest from './shareRequest';

/** Reviewer bar for a pending or reported share: approve, reject or dismiss reports. */
const ShareReviewActions: React.FC<{ preview: SharePreview; reports?: string[]; onDone: () => void }> = ({
  preview,
  reports,
  onDone,
}) => {
  const { token } = theme.useToken();
  const api = useAppApi();
  const [busy, setBusy] = useState<ShareReviewDecision | null>(null);
  const pending = preview.status === 'pending';

  const review = async (decision: ShareReviewDecision) => {
    const note =
      decision === 'reject'
        ? await promptText(api, {
            title: pending ? 'Reject this submission' : 'Take this share down',
            description: 'The publisher sees this note in their share list.',
            okText: 'Reject',
            placeholder: 'What should they change?',
            danger: true,
          })
        : undefined;
    if (note === null) return;
    setBusy(decision);
    const queue = await shareRequest<MarketEntry[]>(api, 'SHARE_REVIEW', {
      id: preview.id,
      revision: preview.revision,
      decision,
      note,
    });
    setBusy(null);
    if (!queue) return;
    useReviewQueue.setState({ entries: queue });
    onDone();
  };

  return (
    <Flex vertical gap={token.marginXS}>
      {!!reports?.length && (
        <Flex vertical>
          <Typography.Text strong>Reports ({reports.length})</Typography.Text>
          {reports.map((reason, index) => (
            <Typography.Text key={index} type="secondary">
              “{reason}”
            </Typography.Text>
          ))}
        </Flex>
      )}
      <Flex gap={token.marginXS} justify="end" wrap>
        {!!reports?.length && (
          <Button loading={busy === 'dismiss-reports'} onClick={() => review('dismiss-reports')}>
            Dismiss reports
          </Button>
        )}
        <Button danger icon={<CloseOutlined />} loading={busy === 'reject'} onClick={() => review('reject')}>
          {pending ? 'Reject' : 'Take down'}
        </Button>
        {pending && (
          <Button type="primary" icon={<CheckOutlined />} loading={busy === 'approve'} onClick={() => review('approve')}>
            Approve
          </Button>
        )}
      </Flex>
    </Flex>
  );
};

export default ShareReviewActions;
