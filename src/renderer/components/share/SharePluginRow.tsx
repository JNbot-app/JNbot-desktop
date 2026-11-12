import { Flex, Segmented, Tag, Typography, theme } from 'antd';
import type { SharePluginAction, SharePluginPreview } from '../../../common/share';
import CodePreview from './CodePreview';

/** Only problems get a tag; signed code is the normal case. */
const VERIFICATION_TAGS: Record<
  SharePluginPreview['verification'],
  React.ReactNode
> = {
  trusted: null,
  'valid-untrusted': null,
  unsigned: <Tag color="warning">Unsigned</Tag>,
  invalid: <Tag color="error">Invalid signature</Tag>,
};

const SharePluginRow: React.FC<{
  plugin: SharePluginPreview;
  choice: SharePluginAction;
  onChoice?: (choice: SharePluginAction) => void;
}> = ({ plugin, choice, onChoice }) => {
  const { token } = theme.useToken();
  const blocked = plugin.state === 'invalid' || plugin.state === 'unsupported';

  return (
    <Flex vertical gap={token.marginXS} style={{ padding: token.paddingSM }}>
      <Flex align="center" gap={token.marginXS} wrap>
        <Typography.Text strong>{plugin.name}</Typography.Text>
        {plugin.scriptType && (
          <Typography.Text
            type="secondary"
            style={{ fontSize: token.fontSizeSM }}
          >
            {plugin.scriptType}
          </Typography.Text>
        )}
        {VERIFICATION_TAGS[plugin.verification]}
        {plugin.state === 'identical' && <Tag>Already installed</Tag>}
        {blocked && (
          <Tag color="error">{plugin.reason ?? 'Cannot be installed'}</Tag>
        )}
      </Flex>
      {plugin.description && (
        <Typography.Text
          type="secondary"
          style={{ fontSize: token.fontSizeSM }}
        >
          {plugin.description}
        </Typography.Text>
      )}
      {plugin.publisherName && plugin.verification !== 'trusted' && (
        <Typography.Text
          type="secondary"
          style={{ fontSize: token.fontSizeSM }}
        >
          Signed by {plugin.publisherName}
        </Typography.Text>
      )}
      {(plugin.state === 'conflict' || plugin.state === 'update') && onChoice && (
        <Flex align="center" gap={token.marginXS} wrap>
          <Typography.Text
            type="secondary"
            style={{ fontSize: token.fontSizeSM }}
          >
            {plugin.state === 'update'
              ? 'This share has an update for this plugin:'
              : 'You already have this plugin:'}
          </Typography.Text>
          <Segmented<SharePluginAction>
            size="small"
            value={choice}
            onChange={onChoice}
            options={
              plugin.state === 'update'
                ? [
                    { label: 'Keep yours', value: 'skip' },
                    { label: 'Update', value: 'replace' },
                  ]
                : [
                    { label: 'Replace', value: 'replace' },
                    { label: 'Skip', value: 'skip' },
                  ]
            }
          />
        </Flex>
      )}
      {plugin.code && <CodePreview code={plugin.code} />}
    </Flex>
  );
};

export default SharePluginRow;
