import React from 'react';
import { theme as antTheme } from 'antd';

interface LauncherBackgroundProps {
  imageUrl?: string;
  children: React.ReactNode;
}

const LauncherBackground: React.FC<LauncherBackgroundProps> = ({ imageUrl, children }) => {
  const {
    token: { colorBgContainer, colorBgLayout, colorBgMask },
  } = antTheme.useToken();

  const defaultGradient = `linear-gradient(135deg, ${colorBgLayout} 0%, ${colorBgContainer} 100%)`;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        borderRadius: '12px',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: imageUrl 
            ? `linear-gradient(135deg, ${colorBgMask}, ${colorBgMask}), url(${imageUrl})`
            : defaultGradient,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(8px) brightness(0.8)',
          transform: 'scale(1.1)',
          transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: `linear-gradient(to bottom, transparent 0%, ${colorBgContainer} 70%, ${colorBgContainer} 100%)`,
        }}
      />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          height: '100%',
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default LauncherBackground;
