import React from 'react';
import { Button, theme as antTheme } from 'antd';
import { PlayCircleFilled } from '@ant-design/icons';

interface PlayButtonProps {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}
const isWeb = window.web;
const PlayButton: React.FC<PlayButtonProps> = ({
  onClick,
  disabled = false,
  loading = false,
}) => {
  const { token } = antTheme.useToken();

  return (
    <Button
      type="primary"
      onClick={onClick}
      disabled={disabled || isWeb}
      loading={loading}
      icon={!loading && <PlayCircleFilled />}
      style={{
        width: '100%',
        height: 42,
        fontSize: 16,
        fontWeight: 600,
        borderRadius: token.borderRadius,
      }}
    >
      {loading ? 'Launching...' : 'Play'}
    </Button>
  );
};

export default PlayButton;
