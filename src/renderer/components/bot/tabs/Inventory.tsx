import React, { useState, useRef, useEffect } from 'react';
import {
  Button,
  Slider,
  Typography,
  theme as antTheme,
} from 'antd';
import {
  LoadingOutlined,
  CloseOutlined,
  RightCircleOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import InventoryWindow from '../../other/botSideBar/panelTabs/inventory/Inventory';
import botActionHandler from '../botActionHandler';
import { BotInfo, InventoryData } from '../types';
import botEvents from '../../../utils/botEvents';
import ChatBar from '../ChatBar';

interface InventoryProps {
  selectedBot: BotInfo;
}

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography.Text
    strong
    style={{
      fontSize: 11,
      letterSpacing: 1,
      textTransform: 'uppercase',
      display: 'block',
      marginBottom: 12,
    }}
  >
    {children}
  </Typography.Text>
);

const Inventory: React.FC<InventoryProps> = ({ selectedBot }) => {
  const [isTossing, setIsTossing] = useState(false);
  const [hotbarSlot, setHotbarSlot] = useState<number>(1);
  const [tossAmount, setTossAmount] = useState<number>(1);
  const slider = useRef<number>(1);
  const { token } = antTheme.useToken();

  useEffect(() => {
    if (!selectedBot) return;
    const unsub = botEvents.subscribe(
      selectedBot.botId,
      'inventory',
      (data: InventoryData) => {
        if (data?.hotbar) setHotbarSlot(data.hotbar);
      },
    );
    return () => unsub();
  }, [selectedBot?.botId]);

  const toss = async () => {
    if (!slider.current) return;
    setIsTossing(true);
    await botActionHandler('tossItems', slider.current, true);
    setIsTossing(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div
        className="unselectable"
        style={{ display: 'flex', justifyContent: 'center' }}
      >
        <InventoryWindow botId={selectedBot.botId} />
      </div>

      <ChatBar small />

      <div>
        <SectionLabel>Inventory actions</SectionLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            icon={<CloseOutlined />}
            onClick={() => botActionHandler('closeWindow')}
            style={{ flex: 1, height: 40 }}
          >
            Close window
          </Button>
          <Button
            icon={<RightCircleOutlined />}
            onClick={() => botActionHandler('activateItem')}
            style={{ flex: 1, height: 40 }}
          >
            Activate item
          </Button>
        </div>
      </div>

      <div>
        <SectionLabel>Toss items</SectionLabel>
        <div
          style={{
            padding: '12px 16px',
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 10,
            background: token.colorBgElevated,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 4,
            }}
          >
            <Typography.Text style={{ fontSize: 12 }}>Amount</Typography.Text>
            <Typography.Text
              style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
            >
              {tossAmount}
            </Typography.Text>
          </div>
          <Slider
            min={1}
            max={64}
            value={tossAmount}
            onChange={(v) => {
              slider.current = v;
              setTossAmount(v);
            }}
            marks={{ 1: '1', 32: '32', 64: '64' }}
          />
          <Button
            icon={isTossing ? <LoadingOutlined /> : <DeleteOutlined />}
            onClick={toss}
            danger
            block
            loading={isTossing}
            style={{ marginTop: 12 }}
          >
            Toss {tossAmount} {tossAmount === 1 ? 'item' : 'items'}
          </Button>
        </div>
      </div>

      <div>
        <SectionLabel>Hotbar slot</SectionLabel>
        <div style={{ display: 'flex', gap: 6 }}>
          {[...Array(9).keys()].map((i) => {
            const slot = i + 1;
            const active = slot === hotbarSlot;
            return (
              <button
                key={slot}
                onClick={() => {botActionHandler('setHotbar', slot); setHotbarSlot(slot);}}
                style={{
                  flex: 1,
                  height: 44,
                  border: `1px solid ${active ? token.colorPrimary : 'transparent'}`,
                  background: active ? `${token.colorPrimary}22` : token.colorFillTertiary,
                  borderRadius: 8,
                  fontWeight: active ? 700 : 500,
                  color: active ? token.colorPrimary : token.colorText,
                  cursor: 'pointer',
                  fontSize: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.15s, border-color 0.15s',
                }}
              >
                {slot}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Inventory;
