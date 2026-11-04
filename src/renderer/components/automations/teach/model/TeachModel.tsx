import { useEffect, useState } from 'react';
import {
  Button,
  Divider,
  Flex,
  Modal,
  Segmented,
  Spin,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import { ApartmentOutlined, ArrowRightOutlined } from '@ant-design/icons';
import {
  brainActionName,
  interactionEffect,
  interactionLabel,
  RECORDING_BRAIN_STEP_MS,
  type BrainModelView,
} from '../../../../../common/brainSpec';
import useAppApi from '../../../../hooks/useAppApi';
import { featureGroup, headOutputs } from './modelLabels';
import ModelInputs from './ModelInputs';
import ModelTree from './ModelTree';

const { Title, Text } = Typography;

/** "How it decides": opens a look inside the trained model. */
export default function TeachModel({ pluginId }: { pluginId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="small"
        type="link"
        icon={<ApartmentOutlined />}
        style={{ padding: 0, alignSelf: 'flex-start' }}
        onClick={() => setOpen(true)}
      >
        How it decides
      </Button>
      <Modal
        title="How the AI decides"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={960}
        destroyOnHidden
      >
        <ModelView pluginId={pluginId} />
      </Modal>
    </>
  );
}

function ModelView({ pluginId }: { pluginId: string }) {
  const { token } = theme.useToken();
  const { message } = useAppApi();
  const [view, setView] = useState<BrainModelView | null>(null);
  const [head, setHead] = useState<string>();

  useEffect(() => {
    window.ipcRenderer
      .get<BrainModelView>('GET_BRAIN_MODEL', { pluginId })
      .then((model) => {
        setView(model);
        setHead(Object.keys(model.heads)[0]);
      })
      .catch((error) => message.error(String(error)));
  }, [message, pluginId]);

  if (!view || !head)
    return (
      <Flex justify="center" style={{ padding: token.paddingXL }}>
        <Spin />
      </Flex>
    );

  const { features, model } = view.heads[head];
  const outputs = headOutputs(head, view.spec);
  const accuracy = view.report.heads[head]?.accuracy;
  // every input any head sees, by group
  const groups = new Map<string, string[]>();
  for (const name of new Set(
    Object.values(view.heads).flatMap((h) => h.features),
  ))
    groups.set(featureGroup(name), [
      ...(groups.get(featureGroup(name)) ?? []),
      name,
    ]);

  return (
    <Flex vertical gap={token.marginMD}>
      <Text type="secondary">
        Every {RECORDING_BRAIN_STEP_MS / 1000} s it looks at what's around it
        and makes one decision per action, each learned from your examples as a
        stack of small decision trees.
      </Text>
      <Flex align="center" gap={token.marginMD} wrap>
        <Flex vertical gap={token.marginXXS}>
          <Text strong>Sees</Text>
          <Flex wrap gap={token.marginXXS}>
            {[...groups].map(([group, names]) => (
              <Tooltip key={group} title={names.join(', ')}>
                <Tag style={{ margin: 0 }}>
                  {group} · {names.length}
                </Tag>
              </Tooltip>
            ))}
          </Flex>
        </Flex>
        <ArrowRightOutlined style={{ color: token.colorTextTertiary }} />
        <Flex vertical gap={token.marginXXS}>
          <Text strong>Decides</Text>
          <Segmented
            value={head}
            onChange={setHead}
            options={Object.keys(view.heads).map((name) => ({
              value: name,
              label: brainActionName(name),
            }))}
          />
        </Flex>
      </Flex>

      <Divider style={{ margin: 0 }} />

      <Flex vertical gap={token.marginXS}>
        <Title level={5} style={{ margin: 0 }}>
          {brainActionName(head)}
        </Title>
        <Flex wrap gap={token.marginXS} align="center">
          {head === 'intent' ? (
            <>
              <Text type="secondary">
                Picks one of these to do next, or nothing
              </Text>
              {view.spec.interactions.map((interaction) => (
                <Tooltip
                  key={interaction.id}
                  title={[
                    interactionEffect(interaction),
                    `${interaction.count}× in your examples`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  <Tag style={{ margin: 0 }}>
                    {interactionLabel(interaction)}
                  </Tag>
                </Tooltip>
              ))}
            </>
          ) : head === 'target' ? (
            <Text type="secondary">
              Scores everything in view it can do the picked action to, and does
              the best one
            </Text>
          ) : (
            <>
              <Text type="secondary">Picks</Text>
              {outputs.map((output) => (
                <Tag key={output} style={{ margin: 0 }}>
                  {output}
                </Tag>
              ))}
            </>
          )}
          {accuracy !== undefined && (
            <Text type="secondary">
              · right {Math.round(accuracy * 100)}% of the time on examples it
              didn't learn from
            </Text>
          )}
        </Flex>
      </Flex>

      <Flex vertical gap={token.marginXS}>
        <Text strong>What it looks at most</Text>
        <ModelInputs model={model} features={features} spec={view.spec} />
      </Flex>

      <Flex vertical gap={token.marginXS}>
        <Text strong>Inside a tree</Text>
        <ModelTree
          key={head}
          model={model}
          features={features}
          outputs={outputs}
          spec={view.spec}
        />
      </Flex>
    </Flex>
  );
}
