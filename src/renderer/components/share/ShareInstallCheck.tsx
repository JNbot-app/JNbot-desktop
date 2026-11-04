import { Checkbox, Flex, Result, Typography, theme } from 'antd';
import {
  defaultPluginAction,
  previewNeedsCheck,
  type SharePluginAction,
  type SharePreview,
} from '../../../common/share';
import SharePluginRow from './SharePluginRow';

export const choiceKey = (plugin: { ownerId: string; pluginId: string }) =>
  `${plugin.ownerId}:${plugin.pluginId}`;

/** The downloaded code, conflicts with what you have, and the publisher trust choice. */
const ShareInstallCheck: React.FC<{
  preview: SharePreview;
  choices: Record<string, SharePluginAction>;
  onChoice: (key: string, choice: SharePluginAction) => void;
  trustPublisher: boolean;
  onTrustPublisher: (trust: boolean) => void;
}> = ({ preview, choices, onChoice, trustPublisher, onTrustPublisher }) => {
  const { token } = theme.useToken();
  const { plugins, publisher } = preview;

  if (preview.ownerChanged) {
    return (
      <Result
        status="warning"
        title="Publisher changed"
        subTitle={`This is now signed by a different key than the copy you installed. It could be someone else using ${publisher.name}'s name, so it will not update your copy.`}
      />
    );
  }

  return (
    <Flex vertical gap={token.marginSM}>
      <Flex vertical>
        <Typography.Text strong>
          {previewNeedsCheck(preview) ? 'Check before installing' : 'Code'}
        </Typography.Text>
        <Typography.Text
          type="secondary"
          style={{ fontSize: token.fontSizeSM }}
        >
          {plugins.length
            ? 'Plugins run code on your computer. Open the code if you want to see what it does.'
            : 'This adds no plugins or code.'}
        </Typography.Text>
      </Flex>
      {plugins.length > 0 && (
        <Flex
          vertical
          style={{
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
          }}
        >
          {plugins.map((plugin, index) => (
            <div
              key={choiceKey(plugin)}
              style={
                index
                  ? { borderTop: `1px solid ${token.colorBorderSecondary}` }
                  : undefined
              }
            >
              <SharePluginRow
                plugin={plugin}
                choice={choices[choiceKey(plugin)] ?? defaultPluginAction(plugin)}
                onChoice={
                  preview.kind === 'profile'
                    ? undefined
                    : (choice) => onChoice(choiceKey(plugin), choice)
                }
              />
            </div>
          ))}
        </Flex>
      )}
      {!publisher.trusted && !preview.reviewed && plugins.length > 0 && (
        <Flex vertical gap={token.marginXXS}>
          <Typography.Text type="warning">
            You have not installed anything from {publisher.name} before. Only
            continue if you trust them.
          </Typography.Text>
          <Checkbox
            checked={trustPublisher}
            onChange={(event) => onTrustPublisher(event.target.checked)}
          >
            Always trust {publisher.name}
          </Checkbox>
        </Flex>
      )}
    </Flex>
  );
};

export default ShareInstallCheck;
