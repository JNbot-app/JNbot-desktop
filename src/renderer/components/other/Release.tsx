import React from 'react';
import { Card, Typography } from 'antd';

const { Text } = Typography;

interface Release {
  tag_name: string;
  published_at: string;
  body: string;
}

const Release: React.FC<{ release: Release }> = ({ release }) => {
  const d = new Date(release.published_at);
  return (
    <div style={{ minWidth: '500px' }}>
      <Card
        title={release.tag_name}
        extra={
          <Text style={{ fontSize: '0.8em' }}>
            {d.toLocaleDateString('default', { day: 'numeric', month: 'long' })}
          </Text>
        }
        style={{
          height: '300px',
          margin: '2rem',
          overflow: 'hidden',
        }}
      >
        <div style={{ textAlign: 'left' }}>
          {release.body?.split('\r\n')?.map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
        </div>
      </Card>
    </div>
  );
};

export default Release;
