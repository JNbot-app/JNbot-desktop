import { Flex, Progress, Tooltip, Typography, theme } from 'antd';
import type { BrainGbdt, BrainSpec } from '../../../../../common/brainSpec';
import { featureLabel } from './modelLabels';

const { Text } = Typography;

const SHOWN = 10;

interface ModelInputsProps {
  model: BrainGbdt;
  features: string[];
  spec: BrainSpec;
}

/** The inputs a head's trees ask about most (split counts, LightGBM's "split" importance). */
export default function ModelInputs({
  model,
  features,
  spec,
}: ModelInputsProps) {
  const { token } = theme.useToken();
  const splits = new Array<number>(features.length).fill(0);
  for (const round of model.trees)
    for (const tree of round) for (const f of tree.f) splits[f]++;
  const top = [...splits.keys()]
    .filter((f) => splits[f])
    .sort((a, b) => splits[b] - splits[a])
    .slice(0, SHOWN);

  if (!top.length)
    return (
      <Text type="secondary">
        It always does the same here: nothing it sees changes this decision.
      </Text>
    );

  return (
    <Flex vertical gap={token.marginXXS}>
      {top.map((f) => (
        <Flex key={f} align="center" gap={token.marginSM}>
          <Tooltip title={features[f]}>
            <Text ellipsis style={{ width: 260, flexShrink: 0 }}>
              {featureLabel(features[f], spec)}
            </Text>
          </Tooltip>
          <Progress
            percent={(splits[f] / splits[top[0]]) * 100}
            showInfo={false}
            size="small"
            style={{ margin: 0, flex: 1 }}
          />
          <Text type="secondary" style={{ width: 70, textAlign: 'right' }}>
            {splits[f]} {splits[f] === 1 ? 'question' : 'questions'}
          </Text>
        </Flex>
      ))}
    </Flex>
  );
}
