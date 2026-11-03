import React from 'react';
import { Card, Tag, Typography, theme as antTheme } from 'antd';
import { MinecraftLauncherTypes } from '../../../common/CommonEnums';
import { launcherLabel } from './versionUtils';

interface VersionCardProps {
  version: string;
  selected: boolean;
  onClick: () => void;
  imageUrl?: string;
  launcherType?: MinecraftLauncherTypes;
}

const VersionCard: React.FC<VersionCardProps> = ({
  version,
  selected,
  onClick,
  imageUrl,
  launcherType,
}) => {
  const {
    token: {
      boxShadow,
      boxShadowSecondary,
      colorBgContainer,
      colorBorderSecondary,
      colorFillSecondary,
      colorPrimary,
      colorTextLightSolid,
      colorWarningBorder,
      colorWarningBg
    },
  } = antTheme.useToken();

  const tagLabel = !launcherType ? null :  launcherLabel(launcherType);

  const isJNbotClient =
    launcherType === MinecraftLauncherTypes.JNBOT_CLIENT;

  return (
    <Card
      hoverable
      onClick={onClick}
      style={{
        backgroundColor: colorBgContainer,
        border: `1px solid ${selected ? colorPrimary : isJNbotClient ? colorWarningBorder : colorBorderSecondary}`,
        cursor: 'pointer',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        transform: selected ? 'scale(1.02)' : 'scale(1)',
        overflow: 'hidden',
        boxShadow: selected ? boxShadowSecondary : boxShadow,
        height: 120,
      }}
      styles={{
        body: { padding: 0, position: 'relative', height: '100%' }
      }}
    >
      {tagLabel && (
        <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 2 }}>
          <Tag
            style={{
              marginInlineEnd: 0,
              backgroundColor: colorWarningBg,
              borderColor: colorWarningBorder,
            }}
          >
            {tagLabel}
          </Tag>
        </div>
      )}
      {imageUrl && (
        <img
          src={imageUrl}
          alt={version}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            position: 'absolute',
            top: 0,
            left: 0,
            filter: selected ? 'brightness(0.7)' : 'brightness(0.5)',
            transition: 'filter 0.3s',
          }}
        />
      )}
      {!imageUrl && (
        <div
          style={{
            height: '100%',
            background: `linear-gradient(135deg, ${colorFillSecondary}, ${colorBgContainer})`,
            transition: 'all 0.3s',
          }}
        />
      )}
      <div style={{ position: 'relative', zIndex: 1, padding: 16, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div>
            <Typography.Text
              strong
              style={{
                fontSize: 28,
                color: imageUrl ? colorTextLightSolid : undefined,
                textShadow: imageUrl ? '0 1px 2px rgba(0,0,0,0.5)' : undefined,
                textAlign: 'center',
              }}
            >
              {version}
            </Typography.Text>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default VersionCard;
