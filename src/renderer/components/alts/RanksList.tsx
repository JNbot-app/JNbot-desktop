import React, { useMemo } from 'react';
import { useSettingsStore, selectAlts } from '../../redux/settings';
import { Card, Typography } from 'antd';
import CountBreakdown from '../other/CountBreakdown';

const RanksList: React.FC = () => {
  const alts = useSettingsStore(selectAlts);

  const ranks = useMemo(() => {
    const _ranks: Record<string, Record<string, number>> = {};
    alts?.forEach((alt) =>
      Object.entries(alt.data?.ranks ?? {}).forEach(([gamemode, rank]) => {
        if (!rank) return;
        _ranks[gamemode] ??= {};
        _ranks[gamemode][rank] = (_ranks[gamemode][rank] ?? 0) + 1;
      }),
    );
    return Object.entries(_ranks);
  }, [alts]);

  return (
    <Card title="Rank counter" style={{ width: '100%' }}>
      {ranks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem 0' }}>
          <Typography.Text type="secondary" >No ranks found</Typography.Text>
        </div>
      ) : (
        <CountBreakdown groups={ranks} />
      )}
    </Card>
  );
};

export default RanksList;
