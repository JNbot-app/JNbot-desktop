import React from 'react';
import InventoryRow from './InventoryRow';
import inventory_text from '../../../../../assets/inventory_text.png';
import { Image } from 'antd';
import { WindowItem } from './Inventory';

interface ChestWindowProps {
  endIndex: number;
  items: WindowItem[];
  botId: number;
}

const ChestWindow: React.FC<ChestWindowProps> = ({ endIndex, items, botId }) => {
  return (
    <>
      {new Array(Math.ceil(endIndex / 9)).fill(0).map((_, i) => (
        <InventoryRow key={i} items={items} startIndex={i * 9} botId={botId} />
      ))}
      <Image
        width={150}
        style={{ position: 'relative', top: '0.5rem' }}
        src={inventory_text}
        preview={false}
      />
    </>
  );
};

export default ChestWindow;
