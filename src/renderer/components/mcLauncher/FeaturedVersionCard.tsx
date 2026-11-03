import React from 'react';
import { Card, Typography,  Space, Divider, theme as antTheme } from 'antd';
import { CheckCircleOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {  type VersionItem } from './VersionBrowser';
import { MinecraftLauncherTypes } from '../../../common/CommonEnums';
import { launcherLabel } from './versionUtils';

interface FeaturedVersionCardProps {
  version: VersionItem | undefined;
  colorBgContainer: string;
  colorBorderSecondary: string;
  colorTextLightSolid: string;
  colorBgMask: string;
}

const FeaturedVersionCard: React.FC<FeaturedVersionCardProps> = ({
  version,
  colorBgContainer,
  colorBorderSecondary,
  colorTextLightSolid,
  colorBgMask,
}) => {
  const { token } = antTheme.useToken();

  if (!version) {
    return (
      <Card
        style={{
          backgroundColor: colorBgContainer,
          border: `1px solid ${colorBorderSecondary}`,
          borderRadius: token.borderRadiusLG,
        }}
      >
        <Typography.Text type="secondary">
          No version selected
        </Typography.Text>
      </Card>
    );
  }

  return (
    <Card
      style={{
        backgroundColor: colorBgContainer,
        border: `1px solid ${colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        overflow: 'hidden',
        boxShadow: token.boxShadowTertiary,
      }}
      styles={{
        body: { padding: 0 },
      }}
    >
      {version.imageUrl ? (
        <div
          style={{
            position: 'relative',
            height: 280,
            backgroundImage: `url(${version.imageUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(to bottom, transparent 50%, ${colorBgMask} 100%)`,
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              padding: 24,
            }}
          >
            <Space orientation="vertical" size={8} style={{ width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>

                <Typography.Title
                  level={2}
                  style={{
                    margin: 0,
                    color: colorTextLightSolid,
                    textShadow: `0 2px 8px ${colorBgMask}`,
                    fontWeight: 700,
                  }}
                >
                  {version.version || version.id}
                </Typography.Title>
                <Typography.Text style={{ textTransform: 'uppercase' }}>
                  {launcherLabel(version.launcherType)}
                </Typography.Text>

                </div>
                
              </div>
            </Space>
          </div>
        </div>
      ) : (
        <div
          style={{
            padding: 24,
            background: `linear-gradient(135deg, ${token.colorPrimaryBg} 0%, ${token.colorBgContainer} 100%)`,
          }}
        >
          <Typography.Title
            level={2}
            style={{
              margin: 0,
              color: token.colorText,
              fontWeight: 700,
            }}
          >
            {version.version || version.id}
          </Typography.Title>
        </div>
      )}

      <div style={{ padding: 24 }}>
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          {version.backgroundImage && (
            <>
            {version.launcherType === MinecraftLauncherTypes.JNBOT_CLIENT &&  <div>
                <Typography.Text
                  strong
                  style={{
                    fontSize: 13,
                    color: token.colorTextSecondary,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Included Features
                </Typography.Text>
                <Divider style={{ margin: '8px 0' }} />
                <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckCircleOutlined style={{ color: token.colorSuccess, fontSize: 16 }} />
                    <Typography.Text>Fabric Mod Loader</Typography.Text>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ThunderboltOutlined style={{ color: token.colorWarning, fontSize: 16 }} />
                    <Typography.Text>JNbot Client Integration</Typography.Text>
                  </div>
                </Space>
              </div>}
            </>
          )}
        </Space>
      </div>
    </Card>
  );
};

export default FeaturedVersionCard;
