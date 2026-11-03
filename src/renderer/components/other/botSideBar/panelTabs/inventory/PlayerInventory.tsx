import React from 'react';
import { Row, Col } from 'antd';
import ItemSlot from './ItemSlot';
import steve from '../../../../../assets/steve.png';
import arrow from '../../../../../assets/craft_arrow.png';
import crafting from '../../../../../assets/crafting_text.png';
import { WindowItem } from './Inventory';

interface PlayerInventoryProps {
  items: WindowItem[];
  botId: number;
}

const PlayerInventory: React.FC<PlayerInventoryProps> = ({ items, botId }) => {
  return (
    <Row gutter={16}>
      <div style={{marginLeft:"0.5rem"}}>
        <div >
          <Row gutter={[0, 0]}>
            <div>

             <ItemSlot slot={items[5]} index={5} botId={botId} />
            <ItemSlot slot={items[6]} index={6} botId={botId} />
            <ItemSlot slot={items[7]} index={7} botId={botId} />
            <ItemSlot slot={items[8]} index={8} botId={botId} />

            </div>
          </Row>
        </div>
      </div>
      <div>
        <div
          style={{
            height: '230px',
            width: '156px',
            background: '#000',
            border: '3px solid',
            borderColor: '#373737 #fff #fff #373737',
          }}
        >
          <img
            width="110px"
            style={{ position: 'relative', top: '1rem', left: '1rem' }}
            src={steve}
            alt="Steve"
          />
        </div>
      </div>
      <div>
        <div style={{ position: 'relative', top: '175px', height: '55px' }}>
          <ItemSlot slot={items[45]} index={45} botId={botId} />
        </div>
      </div>
      <Col md={6}>
        <div style={{ position: 'relative', marginLeft: '2px' }}>
          <img
            width="140px"
            style={{ position: 'absolute', marginTop: '0.5rem' }}
            src={crafting}
            alt="Crafting"
          />
          <Row gutter={[8, 8]} style={{ position: 'relative', top: '2.7rem',left:"0.5rem" }}>
            <div>
              <ItemSlot slot={items[1]} index={1} botId={botId} />
              <ItemSlot slot={items[3]} index={3} botId={botId} />
            </div>
            <div>
              <ItemSlot slot={items[2]} index={2} botId={botId} />
              <ItemSlot slot={items[4]} index={4} botId={botId} />
            </div>
          </Row>
        </div>
      </Col>
      <Col md={1}>
        <img
          width="40px"
          style={{ position: 'relative', top: '5rem',left:"-1.2rem" }}
          src={arrow}
          alt="Arrow"
        />
      </Col>
         <div style={{ position: 'relative', left: '5px', top: '4.5rem' }}>
          <ItemSlot slot={items[0]} index={0} botId={botId} />
        </div>
      <Col md={5}>

      </Col>
    </Row>
  );
};

export default PlayerInventory;
