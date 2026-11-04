import { useState } from 'react';
import { theme } from 'antd';
import {
  AppstoreOutlined,
  CloudServerOutlined,
  CodeOutlined,
  NodeIndexOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { ShareKind } from '../../../common/share';

export const SHARE_KIND_ICONS: Record<ShareKind, React.ReactNode> = {
  plugin: <CodeOutlined />,
  bundle: <AppstoreOutlined />,
  profile: <CloudServerOutlined />,
  chain: <NodeIndexOutlined />,
  trigger: <ThunderboltOutlined />,
};

/** Square tile with an item's image (profile icon) or its kind icon on its accent colour. */
const KindTile: React.FC<{
  kind: ShareKind;
  color?: string;
  src?: string;
  size?: number;
}> = ({ kind, color, src, size = 44 }) => {
  const { token } = theme.useToken();
  const [broken, setBroken] = useState(false);
  const accent = color ?? token.colorPrimary;
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        borderRadius: token.borderRadiusLG,
        background: `linear-gradient(135deg, ${accent}40, ${accent}12)`,
        boxShadow: `inset 0 0 0 1px ${accent}33`,
        color: accent,
        fontSize: size * 0.45,
      }}
    >
      {src && !broken ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        SHARE_KIND_ICONS[kind]
      )}
    </div>
  );
};

export default KindTile;
