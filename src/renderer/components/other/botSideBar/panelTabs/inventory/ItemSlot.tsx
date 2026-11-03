import { McAnsiText } from './Mc';
import textures from './textures.json';
import { FC, Fragment } from 'react';
import { Tooltip, Typography } from 'antd';
import { WindowItem } from './Inventory';
import botEvents from '../../../../../utils/botEvents';

type ItemSlotProps = {
  index: number;
  slot: WindowItem;
  selected?: boolean;
  onHoverSlot?: (slot: number | null) => void;
  botId: number;
};

const ItemSlot: FC<ItemSlotProps> = ({
  index,
  slot,
  selected,
  onHoverSlot,
  botId
}) => {

  const handleLeftClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      botEvents.action(botId, 'inventoryClick', {
        slot: index,
        button: 0,
        mode: 1,
      });
    } else {
      botEvents.action(botId, 'inventoryClick', { slot: index, button: 0 });
    }
  };
  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (e.shiftKey) {
      botEvents.action(botId, 'inventoryClick', {
        slot: index,
        button: 1,
        mode: 1,
      });
    } else {
      botEvents.action(botId, 'inventoryClick', { slot: index, button: 1 });
    }
  };

  const handleMouseEnter = () => onHoverSlot?.(index);
  const handleMouseLeave = () => onHoverSlot?.(null);
  return (
    <Tooltip
    
      classNames={{ root: 'item-tooltip tooltip-mc-text' }}
      styles={{
        container: {
          background: 'transparent',
          padding: 0,
          border: 0,
          pointerEvents: 'none',
          width: 'max-content',
        },

        root: { maxWidth: '800px', fontSize: '1em' },
      }}
      mouseEnterDelay={0}
      mouseLeaveDelay={0}
      arrow={false}
      placement="rightTop"
      align={{
        offset: [10, -25],
      }}
      title={
        slot ? (
          <div style={{ pointerEvents: 'none' }}>
            <McAnsiText
              text={slot?.display?.name || slot?.displayName}
              fontSize={16}
            />
            <br />

            {(slot?.display.lore.split('\n') ?? []).map((info, i) => (
              <Fragment key={i}>
                <McAnsiText text={info} fontSize={16} />
                <br />
              </Fragment>
            ))}
          </div>
        ) : null
      }
    >
      <div>
        <div
          className={'item-slot ' + (selected ? 'item-slot-selected' : '')}
          onClick={handleLeftClick}
          onContextMenu={handleRightClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {slot?.name ? (
            <img
              width="45px"
              height="45px"
              style={{
                position: 'relative',

                zIndex: '96',
              }}
              src={(textures as Record<string, string>)[slot?.name]}
            />
          ) : null}
          <Typography.Text
            className="unselectable"
            style={{
              fontSize: '1.2em',
              fontWeight: '800',
              position: 'absolute',
              transform: 'translate(15px, 20px)',
              color: 'black',
              zIndex: '97',
            }}
          >
            {slot?.count > 1 ? slot.count : ''}
          </Typography.Text>
        </div>
      </div>
    </Tooltip>
  );
};

export default ItemSlot;
