import React, { useState } from 'react';
import { Flex } from 'antd';
import { MdAdd, MdArrowForward } from 'react-icons/md';
import ItemSlot from './ItemSlot';
import type { WindowItem } from './Inventory';
import botEvents from '../../../../../utils/botEvents';

interface AnvilWindowProps {
  items: WindowItem[];
  botId: number;
  onHoverSlot: (slot: number | null) => void;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const itemName = (item?: WindowItem) =>
  (item?.display?.name || item?.displayName || '').replace(ANSI_RE, '');

/** Rename field; vanilla sends the name on every keystroke. */
const AnvilNameField: React.FC<{
  initial: string;
  disabled: boolean;
  botId: number;
}> = ({ initial, disabled, botId }) => {
  const [name, setName] = useState(initial);
  return (
    <input
      className="mc-field"
      value={name}
      maxLength={50}
      disabled={disabled}
      spellCheck={false}
      aria-label="Item name"
      onChange={(e) => {
        setName(e.target.value);
        botEvents.action(botId, 'renameItem', e.target.value);
      }}
    />
  );
};

const AnvilWindow: React.FC<AnvilWindowProps> = ({
  items,
  botId,
  onHoverSlot,
}) => {
  const source = items[0];
  const slot = (index: number) => (
    <ItemSlot
      index={index}
      slot={items[index]}
      botId={botId}
      onHoverSlot={onHoverSlot}
    />
  );

  return (
    <Flex vertical align="center" gap={16} style={{ padding: '1rem 0' }}>
      <div style={{ width: 320 }}>
        {/* Reset the field when a different item is put in */}
        <AnvilNameField
          key={`${source?.name}|${itemName(source)}`}
          initial={itemName(source)}
          disabled={!source?.name}
          botId={botId}
        />
      </div>
      <Flex align="center" gap={16} className="mc-anvil-row">
        {slot(0)}
        <MdAdd size={28} />
        {slot(1)}
        <MdArrowForward size={28} />
        {slot(2)}
      </Flex>
    </Flex>
  );
};

export default AnvilWindow;
