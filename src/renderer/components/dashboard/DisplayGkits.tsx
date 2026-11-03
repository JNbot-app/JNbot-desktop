import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useSettingsStore,
  selectAlts,
  selectScripts,
} from '../../redux/settings';
import { Typography, Button } from 'antd';
import { MdFormatListBulleted } from 'react-icons/md';
import Card from '../Card';
import CountBreakdown from '../other/CountBreakdown';
const { Paragraph } = Typography;

interface DisplayGkitsProps {
  large?: boolean;
}

const DisplayGkits: React.FC<DisplayGkitsProps> = ({ large }) => {
  const alts = useSettingsStore(selectAlts);
  const navigate = useNavigate();

  const gkits = useMemo(() => {
    const gkitData: Record<string, Record<string, number>> = {};
    alts?.forEach((alt) =>
      Object.entries(alt.data?.gkits ?? {}).forEach(([gamemode, list]: any) =>
        list?.forEach((gkit: string) => {
          gkitData[gamemode] ??= {};
          gkitData[gamemode][gkit] = (gkitData[gamemode][gkit] ?? 0) + 1;
        }),
      ),
    );
    return Object.entries(gkitData);
  }, [alts]);

  return (
    <Card
      title="Gkit counter"
      style={large ? { width: '100%', height: '100%' } : { height: '100%' }}
      icon={<MdFormatListBulleted />}
      styles={{
        body: {
          height: '100%',
          maxHeight: '500px',
          overflow: 'auto',
        },
      }}
    >
      <div style={large ? {} : { overflow: 'auto' }}>
        {gkits.length ? (
          <CountBreakdown groups={gkits} />
        ) : (
          <div style={{ textAlign: 'center' }}>
            {alts?.length ? (
              <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                <Typography.Text type="secondary">No gkits found</Typography.Text>
              </div>
            ) : (
              <>
                <Paragraph>No alts found</Paragraph>
                {!large && (
                  <Button onClick={() => navigate('/alts')}>
                    Add your alts
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

export default DisplayGkits;
