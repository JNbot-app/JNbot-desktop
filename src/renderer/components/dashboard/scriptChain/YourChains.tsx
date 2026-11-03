import { FC } from 'react';
import { Button, Card, Empty, Flex, Menu, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useSettingsStore } from '../../../redux/settings';
import type { Chain } from '../../../../main/src/types';
import ChainStatus from './ChainStatus';

const EMPTY_CHAINS: Record<string, Chain> = {};

const YourChains: FC<{
  selectedChainId: string;
  setSelectedChain: (c: string) => void;
  onCreate: () => void;
}> = ({ selectedChainId, setSelectedChain, onCreate }) => {
  const scripts = useSettingsStore((state) => state.settings.scripts);
  const chains = Object.values(scripts?.chains ?? EMPTY_CHAINS);

  return (
    <Card
      title="Your chains"
      style={{ maxHeight: 700, height: '100%', overflow: 'auto' }}
      styles={{ body: { padding: 8 } }}
      extra={
        <Button type="text" onClick={onCreate} icon={<PlusOutlined />}>
          New chain
        </Button>
      }
    >
      {chains.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Run several actions in order, for each of your alts."
          style={{ padding: 24 }}
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
            Create your first chain
          </Button>
        </Empty>
      ) : (
        <Menu
          mode="vertical"
          style={{ borderInlineEnd: 'none', background: 'transparent' }}
          selectedKeys={selectedChainId ? [selectedChainId] : []}
          items={chains.map((chain) => {
            const options = scripts?.[chain.id];
            const steps = chain.chains.length;
            return {
              key: chain.id,
              onClick: () => setSelectedChain(chain.id),
              style: { height: 'auto', lineHeight: 1.45, paddingBlock: 10 },
              label: (
                <Flex align="center" gap={12}>
                  <Flex vertical style={{ minWidth: 0, flex: 1 }}>
                    <Typography.Text strong ellipsis>
                      {options?.name ?? chain.name ?? 'Unnamed chain'}
                    </Typography.Text>
                    <Typography.Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                      {options?.description || `${steps} step${steps === 1 ? '' : 's'}`}
                    </Typography.Text>
                  </Flex>
                  <ChainStatus chain={chain} />
                </Flex>
              ),
            };
          })}
        />
      )}
    </Card>
  );
};

export default YourChains;
