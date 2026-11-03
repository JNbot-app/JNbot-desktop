import React, { useEffect, useState, useRef } from 'react';
import { Spin, Typography, theme } from 'antd';
import PlayerInventory from './PlayerInventory';
import InventoryRow from './InventoryRow';
import ChestWindow from './ChestWindow';
import AnvilWindow from './AnvilWindow';
import PromptScreen from './PromptScreen';
import botEvents from '../../../../../utils/botEvents';
import { McAnsiText } from './Mc';
import textures from './textures.json';
import type { ScreenPrompt } from '../../../../../../main/src/workers/workerTypes';

interface InventoryProps {
  botId: number;
}

export type WindowItem = {
  display: {
    name: string;
    lore: string;
  };
  name: string;
  count: number;
  displayName: string;
};

export type InventoryData = {
  items: WindowItem[];
  isInventory: boolean;
  title: string;
  inventoryStart: number;
  selected: number;
  selectedItem: WindowItem | null;
  type: string;
  prompt: ScreenPrompt | null;
  map: string | null;
};

const Inventory: React.FC<InventoryProps> = ({ botId }) => {
  const [inventory, setInventory] = useState<InventoryData | null>(null);
  const { token } = theme.useToken();
  const hoveredSlotRef = useRef<number | null>(null);
  const heldItemRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef({ x: 0, y: 0, inside: false });

  const moveHeldItem = (event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerRef.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      inside: true,
    };
    if (heldItemRef.current) {
      heldItemRef.current.style.left = `${pointerRef.current.x}px`;
      heldItemRef.current.style.top = `${pointerRef.current.y}px`;
      heldItemRef.current.style.display = 'block';
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    )
      return;
    if (event.code === 'Escape') {
      botEvents.action(botId, 'closeWindow');
      return;
    }
    const hoveredSlot = hoveredSlotRef.current;
    if (event.code === 'KeyQ' && hoveredSlot !== null) {
      botEvents.action(botId, 'inventoryClick', {
        slot: hoveredSlot,
        button: event.shiftKey ? 1 : 0,
        mode: 4,
      });
      return;
    }

    if (event.code.startsWith?.('Digit') && !event.code.endsWith('0')) {
      const digit = parseInt(event.code.replace(/[^0-9]/g, ''), 10);
      if (!digit) return;
      if (hoveredSlot !== null) {
        botEvents.action(botId, 'inventoryClick', {
          slot: hoveredSlot,
          button: digit - 1,
          mode: 2,
        });
      } else {
        botEvents.action(botId, 'setHotbar', digit);
      }
      return;
    }
  };

  useEffect(() => {
    setInventory(null);

    const unsub = botEvents.subscribe(
      botId,
      'inventory',
      (inv: InventoryData) => {
        if (!inv || typeof inv.isInventory !== 'boolean') return;
        setInventory(inv);
      },
      {
        ignorePrevious: true,
        throttle: 100,
      },
    );

    botEvents.action(botId, 'sendInventoryPacket');

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      unsub();
    };
  }, [botId]);

  const onHoverSlotChange = (slot: number | null) => {
    hoveredSlotRef.current = slot;
  };

  if (!inventory) {
    return (
      <div style={{ overflow: 'hidden' }}>
        <div
          style={{
            width: '570px',
            minHeight: '500px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 16,
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: '1rem',
            position: 'relative',
            left: '-0.25rem',
          }}
        >
          <Spin size="large" />
          <Typography.Text type="secondary" style={{ fontSize: 14 }}>
            Loading inventory...
          </Typography.Text>
        </div>
      </div>
    );
  }

  return (
    <div style={{ overflow: 'hidden' }}>
      <div
        id="inventory"
        onContextMenu={(e) => e.preventDefault()}
        onMouseMove={moveHeldItem}
        onMouseLeave={() => {
          pointerRef.current.inside = false;
          if (heldItemRef.current) heldItemRef.current.style.display = 'none';
        }}
        style={{
          width: '570px',
          height: '100%',
          zIndex: 99,
          background: '#C6C6C6',
          borderRadius: '1rem',
          border: '5px solid',
          borderColor: '#fff #555555 #555555 #fff',
          position: 'relative',
          left: '-0.25rem',
          minHeight: '500px',
          padding: '0.5rem',
          overflow: 'hidden',
        }}
      >
        {inventory.prompt ? (
          <PromptScreen prompt={inventory.prompt} botId={botId} />
        ) : (
          <>
            {inventory.map && (
              <img className="mc-map" src={inventory.map} alt="Held map" />
            )}
            {inventory.title && (
              <span style={{ pointerEvents: 'none' }}>
                <McAnsiText text={inventory.title} fontSize={16} />
              </span>
            )}

            <div style={{ padding: '0.5rem' }}>
              {inventory.isInventory ? (
                <PlayerInventory items={inventory.items} botId={botId} />
              ) : inventory.type === 'minecraft:anvil' ? (
                <AnvilWindow
                  items={inventory.items}
                  botId={botId}
                  onHoverSlot={onHoverSlotChange}
                />
              ) : (
                <ChestWindow
                  items={inventory.items}
                  endIndex={inventory.inventoryStart}
                  botId={botId}
                />
              )}
              <InventoryRow
                items={inventory.items}
                br
                startIndex={inventory.inventoryStart}
                onHoverSlot={onHoverSlotChange}
                botId={botId}
              />
              <InventoryRow
                items={inventory.items}
                startIndex={inventory.inventoryStart + 9}
                onHoverSlot={onHoverSlotChange}
                botId={botId}
              />
              <InventoryRow
                items={inventory.items}
                startIndex={inventory.inventoryStart + 18}
                onHoverSlot={onHoverSlotChange}
                botId={botId}
              />
              <InventoryRow
                items={inventory.items}
                selected={inventory.selected}
                br
                startIndex={inventory.inventoryStart + 27}
                onHoverSlot={onHoverSlotChange}
                botId={botId}
              />
            </div>
          </>
        )}
        {inventory.selectedItem?.name && (
          <div
            ref={heldItemRef}
            aria-label={`Holding ${inventory.selectedItem.displayName}, ${inventory.selectedItem.count}`}
            style={{
              position: 'absolute',
              left: pointerRef.current.x,
              top: pointerRef.current.y,
              display: pointerRef.current.inside ? 'block' : 'none',
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
              zIndex: 100,
            }}
          >
            <img
              width={45}
              height={45}
              src={
                (textures as Record<string, string>)[
                  inventory.selectedItem.name
                ]
              }
              alt={inventory.selectedItem.displayName}
            />
            {inventory.selectedItem.count > 1 && (
              <span
                style={{
                  position: 'absolute',
                  right: 0,
                  bottom: 0,
                  color: 'black',
                  fontWeight: 800,
                }}
              >
                {inventory.selectedItem.count}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Inventory;
