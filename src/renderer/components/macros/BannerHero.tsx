import React, { useState } from 'react';
import { theme } from 'antd';

const BannerHero: React.FC<{
  src?: string;
  height: number;
  accent?: string;
  /** Shown instead of the image when there is none or it fails to load. */
  fallback?: React.ReactNode;
  /** Zooms the image in slightly, e.g. while the card is hovered. */
  zoomed?: boolean;
  children?: React.ReactNode;
}> = ({ src, height, accent, fallback, zoomed, children }) => {
  const { token } = theme.useToken();
  const [broken, setBroken] = useState(false);
  const useImage = !!src && !broken;
  return (
    <div
      style={{
        position: 'relative',
        height,
        flexShrink: 0,
        overflow: 'hidden',
        background: useImage
          ? token.colorFillTertiary
          : accent
            ? `linear-gradient(135deg, ${accent}33, ${accent}11)`
            : token.colorFillTertiary,
      }}
    >
      {useImage && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            transform: zoomed ? 'scale(1.08)' : 'none',
            transition: `transform ${token.motionDurationSlow} ${token.motionEaseOut}`,
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: useImage
            ? `linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0.1) 100%)`
            : 'transparent',
        }}
      />
      <div style={{ position: 'relative', height: '100%' }}>
        {!useImage && fallback}
        {children}
      </div>
    </div>
  );
};

export default BannerHero;
