import { useState } from 'react';
import {
  Flex,
  Segmented,
  Slider,
  Tag,
  Tree,
  Typography,
  theme,
  type TreeDataNode,
} from 'antd';
import type {
  BrainGbdt,
  BrainSpec,
  BrainTree,
} from '../../../../../common/brainSpec';
import { splitQuestion } from './modelLabels';

const { Text } = Typography;

interface ModelTreeProps {
  model: BrainGbdt;
  features: string[];
  outputs: string[];
  spec: BrainSpec;
}

/** One of the head's trees as yes/no questions, its leaves nudging an output. */
export default function ModelTree({
  model,
  features,
  outputs,
  spec,
}: ModelTreeProps) {
  const { token } = theme.useToken();
  const [round, setRound] = useState(0);
  const [output, setOutput] = useState(0);
  const tree = model.trees[round]?.[output];
  const rounds = model.trees.length;

  const leaf = (value: number) => {
    const effect = `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
    const sign = value > 0 ? 'more' : 'less';
    return model.objective === 'regression' ? (
      <Text code>{effect}</Text>
    ) : (
      <Text type={value > 0 ? 'success' : 'danger'}>
        {effect} {sign} likely to {outputs[output]}
      </Text>
    );
  };

  const node = (
    t: BrainTree,
    n: number,
    key: string,
    answer?: 'yes' | 'no',
  ): TreeDataNode => {
    const prefix = answer && (
      <Tag color={answer === 'yes' ? 'blue' : 'default'}>{answer}</Tag>
    );
    if (n < 0)
      return {
        key,
        title: (
          <>
            {prefix}
            {leaf(t.v[~n])}
          </>
        ),
        isLeaf: true,
      };
    // NaN goes left only when it learned to: worth saying then
    const missing = t.nanLeft[n] ? ' (or unknown)' : '';
    return {
      key,
      title: (
        <>
          {prefix}
          <Text strong>{splitQuestion(features[t.f[n]], t.t[n], spec)}</Text>
          <Text type="secondary">{missing}?</Text>
        </>
      ),
      children: [
        node(t, t.l[n], `${key}y`, 'yes'),
        node(t, t.r[n], `${key}n`, 'no'),
      ],
    };
  };

  return (
    <Flex vertical gap={token.marginSM}>
      <Text type="secondary">
        Every {model.objective === 'regression' ? 'value' : 'decision'} adds up{' '}
        {rounds} small trees like this one, each answering a few yes/no
        questions about what the AI sees.
      </Text>
      <Flex wrap gap={token.marginMD} align="center">
        {outputs.length > 1 && (
          <Segmented
            size="small"
            value={output}
            onChange={setOutput}
            options={outputs.map((label, value) => ({ label, value }))}
          />
        )}
        {rounds > 1 && (
          <Flex
            align="center"
            gap={token.marginXS}
            style={{ flex: 1, minWidth: 200 }}
          >
            <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
              Tree {round + 1} of {rounds}
            </Text>
            <Slider
              min={0}
              max={rounds - 1}
              value={round}
              onChange={setRound}
              tooltip={{ formatter: (value) => (value ?? 0) + 1 }}
              style={{ flex: 1 }}
            />
          </Flex>
        )}
      </Flex>
      {tree && (
        <Tree
          key={`${round}-${output}`}
          showLine
          blockNode
          selectable={false}
          defaultExpandAll
          treeData={[node(tree, tree.root, 'r')]}
        />
      )}
    </Flex>
  );
}
