import { FC } from 'react';
import {
  Avatar,
  Button,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import {
  ApiOutlined,
  CheckCircleFilled,
  DeleteOutlined,
  DownOutlined,
  ExclamationCircleFilled,
  EyeInvisibleOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { SOURCE_LABELS, type ProfileScript } from '../../../../common/profileScripts';
import { useResolveScript } from './useResolveScript';

const { Text } = Typography;

const sourceIcon = (kind: ProfileScript['source']['kind']) =>
  kind === 'plugin' ? (
    <ApiOutlined />
  ) : kind === 'url' ? (
    <LinkOutlined />
  ) : (
    <FolderOpenOutlined />
  );

interface Props {
  script: ProfileScript;
  index: number;
  total: number;
  onMove?: (delta: -1 | 1) => void;
  onRemove: () => void;
  /** When set, renders an eye toggle that flips `script.hidden`. */
  onToggleHidden?: () => void;
}

/**
 * One row of the script list inside the wizard's Scripts step. Resolves
 * the underlying plugin info on mount and displays its real name/banner,
 * so the user sees exactly what will appear on the dashboard.
 */
const ProfileScriptRow: FC<Props> = ({
  script,
  index,
  total,
  onMove,
  onRemove,
  onToggleHidden,
}) => {
  const { token } = theme.useToken();
  const { info, code, loading, error, verified, checksumOk } = useResolveScript(script);

  const name = info?.name ?? '(failed to load)';
  const banner = info?.banner;
  const verifyTag = error ? (
    <Tooltip title={error}>
      <Tag color="error" icon={<ExclamationCircleFilled />}>
        Unavailable
      </Tag>
    </Tooltip>
  ) : verified ? (
    <Tooltip title="Package signature and checksum verified">
      <Tag color="success" icon={<CheckCircleFilled />}>Verified</Tag>
    </Tooltip>
  ) : script.signature && !code ? (
    <Tooltip title="Signature will be verified against fresh code before execution">
      <Tag color="processing">Signed</Tag>
    </Tooltip>
  ) : script.signature ? (
    <Tooltip title="The current code does not match this package signature">
      <Tag color="warning">Modified</Tag>
    </Tooltip>
  ) : checksumOk ? (
    <Tooltip title="Checksum matches but the script is not signed">
      <Tag color="warning">Unsigned</Tag>
    </Tooltip>
  ) : script.checksum ? (
    <Tooltip title="Code has changed since the profile was created">
      <Tag color="warning">Modified</Tag>
    </Tooltip>
  ) : null;

  const isHidden = !!script.hidden;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        opacity: isHidden ? 0.6 : 1,
      }}
    >
      <Avatar
        shape="square"
        size={48}
        src={banner || undefined}
        style={{ background: token.colorPrimaryBg, flex: 'none' }}
      >
        {name?.[0]?.toUpperCase() ?? '?'}
      </Avatar>

      <div style={{ flex: 1, minWidth: 0 }}>
        {loading ? (
          <Skeleton.Input active size="small" style={{ width: 160 }} />
        ) : (
          <Text strong style={{ display: 'block' }}>{name}</Text>
        )}
        <Space size={6} wrap>
          <Tag icon={sourceIcon(script.source.kind)}>
            {SOURCE_LABELS[script.source.kind]}
          </Tag>
          {info?.scriptType === 'action' && <Tag color="purple">Action</Tag>}
          {isHidden && <Tag>Hidden</Tag>}
          {verifyTag}
        </Space>
      </div>

      {onToggleHidden && (
        <Tooltip
          title={
            isHidden
              ? 'Hidden from dashboard, still runnable from action runner'
              : 'Hide from dashboard'
          }
        >
          <Button
            type="text"
            icon={isHidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            onClick={onToggleHidden}
          />
        </Tooltip>
      )}

      {onMove && (
        <Space.Compact>
          <Button
            icon={<UpOutlined />}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          />
          <Button
            icon={<DownOutlined />}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          />
        </Space.Compact>
      )}
      <Button danger type="text" icon={<DeleteOutlined />} onClick={onRemove} />
    </div>
  );
};

export default ProfileScriptRow;
