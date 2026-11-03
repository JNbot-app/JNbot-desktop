import React, { useEffect, useState } from 'react';
import { Button, Typography } from 'antd';
import botActionHandler from '../botActionHandler';

type MouseButton = 'left' | 'right';
type MouseState = Record<MouseButton, boolean>;

const BUTTONS: { button: MouseButton; label: string }[] = [
  { button: 'left', label: 'Left click' },
  { button: 'right', label: 'Right click' },
];

const MouseControls: React.FC<{ botId: number }> = ({ botId }) => {
  const [held, setHeld] = useState<MouseState>({ left: false, right: false });

  const mouse = async (data?: { button: MouseButton; mode: string }) => {
    const state = await botActionHandler('mouse', data, true);
    if (state) setHeld(state);
  };

  useEffect(() => {
    mouse();
  }, [botId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {BUTTONS.map(({ button, label }) => (
        <div key={button} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Typography.Text style={{ flex: 1 }}>{label}</Typography.Text>
          <Button onClick={() => mouse({ button, mode: 'click' })}>Click</Button>
          <Button
            type={held[button] ? 'primary' : 'default'}
            onClick={() =>
              mouse({ button, mode: held[button] ? 'release' : 'press' })
            }
            style={{ minWidth: 90 }}
          >
            {held[button] ? 'Release' : 'Hold'}
          </Button>
        </div>
      ))}
    </div>
  );
};

export default MouseControls;
