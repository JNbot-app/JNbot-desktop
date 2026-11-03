import React from 'react';
import { Row, Col } from 'antd';
import ItemSlot from './ItemSlot';
import { WindowItem } from './Inventory';



interface InventoryRowProps {
  startIndex: number;
  br?: boolean;
  items: WindowItem[];
  selected?: number;
  onHoverSlot?: (slot: number | null) => void;
  botId: number;
}

const InventoryRow: React.FC<InventoryRowProps> = ({ startIndex, br, items, selected, onHoverSlot, botId }) => {
  return (
    <Row gutter={[0, br ? 24 : 0]} style={{ marginTop: br ? '1.5rem' : 0 }}>
      {new Array(9).fill(0).map((_, i) => (
        <Col span={24 / 9} key={i}>
          <ItemSlot
            selected={typeof selected === "number" && !isNaN(selected) && selected === (i + startIndex) % 9}
            slot={items[i + startIndex]}
            index={i + startIndex}
            onHoverSlot={onHoverSlot}
            botId={botId}
          />
        </Col>
      ))}
    </Row>
  );
};

export default InventoryRow;
