import { Tag, Tooltip } from 'antd';
import { shareStatusLabel, type OwnedShare } from '../../../common/share';

/** Visibility and review state of a share, with the review note as tooltip. */
const ShareStatusTag: React.FC<{ share: Pick<OwnedShare, 'visibility' | 'status' | 'note' | 'pending'> }> = ({
  share,
}) => {
  const { tone, label } = shareStatusLabel(share);
  const tag = <Tag color={tone}>{label}</Tag>;
  return share.note ? <Tooltip title={share.note}>{tag}</Tooltip> : tag;
};

export default ShareStatusTag;
