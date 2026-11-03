import React from 'react';
import { Row, Col, Typography } from 'antd';
import VersionCard from './VersionCard';
import { MinecraftLauncherTypes } from '../../../common/CommonEnums';

interface Version {
  id: string;
  version: string;
  type: 'release' | 'snapshot' | 'legacy';
  backgroundImage?: string;
  imageUrl?: string;
}

interface VersionSelectorProps {
  versions: Version[];
  selectedVersion: string | null;
  onSelect: (versionId: string) => void;
}

const VersionSelector: React.FC<VersionSelectorProps> = ({
  versions,
  selectedVersion,
  onSelect,
}) => {
  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        Select Version
      </Typography.Title>
      <Row gutter={[12, 12]}>
        {versions.map((version) => (
          <Col xs={24} sm={12} md={8} lg={6} key={version.id}>
            <VersionCard
              version={version.version}
              selected={selectedVersion === version.id}
              onClick={() => onSelect(version.id)}
              imageUrl={version.imageUrl}
              launcherType={MinecraftLauncherTypes.VANILLA}
            />
          </Col>
        ))}
      </Row>
    </div>
  );
};

export default VersionSelector;
