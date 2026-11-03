import { useState } from 'react';
import { Button, Flex, Segmented, Tag, Typography, theme } from 'antd';
import type { SharePluginPreview } from '../../../common/share';

export type PluginChoice = 'replace' | 'keep-both' | 'skip';

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
  choice: PluginChoice;
  onChoice?: (choice: PluginChoice) => void;
}> = ({ plugin, choice, onChoice }) => {
  const { token } = theme.useToken();
  const [showCode, setShowCode] = useState(false);
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
      {plugin.state === 'conflict' && onChoice && (
        <Flex align="center" gap={token.marginXS} wrap>
          <Typography.Text
            type="secondary"
            style={{ fontSize: token.fontSizeSM }}
          >
            You already have this plugin:
          </Typography.Text>
          <Segmented<PluginChoice>
            size="small"
            value={choice}
            onChange={onChoice}
            options={[
              { label: 'Replace', value: 'replace' },
              { label: 'Keep both', value: 'keep-both' },
              { label: 'Skip', value: 'skip' },
            ]}
          />
        </Flex>
      )}
      {plugin.code && (
        <div>
          <Button
            size="small"
            type="link"
            style={{ padding: 0 }}
            onClick={() => setShowCode(!showCode)}
          >
            {showCode ? 'Hide code' : 'View code'}
          </Button>
          {showCode && (
            <pre
              style={{
                margin: `${token.marginXS}px 0 0`,
                maxHeight: 320,
                overflow: 'auto',
                padding: token.paddingSM,
                background: token.colorFillTertiary,
                borderRadius: token.borderRadius,
                fontSize: token.fontSizeSM,
                fontFamily: token.fontFamilyCode,
              }}
            >
              {plugin.code}
            </pre>
          )}
        </div>
      )}
    </Flex>
  );
};

export default SharePluginRow;
