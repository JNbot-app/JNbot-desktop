import React from 'react';
import { theme } from 'antd';

export interface NoBotsOnlineSvgProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
}

export const NoBotsOnlineSvg: React.FC<NoBotsOnlineSvgProps> = ({
  size = 185,
  style,
  className,
  ...props
}) => {
  const { token } = theme.useToken();

  return (
    <svg
      viewBox="0 0 512 512"
      fill="currentColor"
      className={className ? `unselectable undragable ${className}` : 'unselectable undragable'}
      style={{
        width: size,
        height: size,
        color: token.colorTextSecondary,
        opacity: 0.1,
        ...style,
      }}
      aria-label="No bots online"
      {...props}
    >
      {/* Antenna */}
      <circle cx="256" cy="120" r="24" />
      <rect x="244" y="140" width="24" height="60" rx="12" />

      {/* Floating ZZZ */}
      <path
        d="M396 195 h 22 l -22 24 h 22"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M434 147 h 28 l -28 30 h 28"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M472 93 h 34 l -34 38 h 34"
        stroke="currentColor"
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Ear Bolts */}
      <rect x="86" y="265" width="34" height="92" rx="17" />
      <rect x="392" y="265" width="34" height="92" rx="17" />

      {/* Robot Head with Screen Cutout */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M160 196 C137.9 196 120 213.9 120 236 V382 C120 404.1 137.9 422 160 422 H352 C374.1 422 392 404.1 392 382 V236 C392 213.9 374.1 196 352 196 H160 Z M174 234 H338 C350 234 360 244 360 256 V362 C360 374 350 384 338 384 H174 C162 384 152 374 152 362 V256 C152 244 162 234 174 234 Z"
      />

      {/* Minimalist Standby / Sleeping Visor Bars */}
      <rect x="180" y="300" width="56" height="16" rx="8" />
      <rect x="276" y="300" width="56" height="16" rx="8" />
    </svg>
  );
};

export default NoBotsOnlineSvg;
