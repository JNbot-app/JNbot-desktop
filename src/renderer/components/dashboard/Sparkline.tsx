import { FC } from 'react';
import { Tooltip } from 'antd';
import { HISTORY_WEEKS, weekIndex } from '../../../common/statsHistory';

interface SparklineProps {
  /** Weekly values, oldest → newest; the last one is the current week. */
  values: number[];
  color: string;
  format: (value: number) => string;
}

const BAR = 6;
const GAP = 3;
const HEIGHT = 24;
const DAY = 86_400_000;

// Inverse of weekIndex: the week's Monday, formatted as a UTC calendar date.
const weekStart = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekLabel = (week: number, current: number) =>
  week === current ? 'This week' : `Week of ${weekStart.format((week * 7 - 3) * DAY)}`;

/** Weekly bars, right-aligned so a short history still lines up with the current week. */
const Sparkline: FC<SparklineProps> = ({ values, color, format }) => {
  const max = Math.max(...values, 1);
  const width = HISTORY_WEEKS * (BAR + GAP) - GAP;
  const offset = (HISTORY_WEEKS - values.length) * (BAR + GAP);
  const current = weekIndex();

  return (
    <svg
      width="100%"
      height={HEIGHT}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {values.map((v, i) => {
        const x = offset + i * (BAR + GAP);
        const h = Math.max(2, (v / max) * HEIGHT);
        const last = i === values.length - 1;
        const week = current - (values.length - 1 - i);
        return (
          <Tooltip key={i} title={`${weekLabel(week, current)}: ${format(v)}`} mouseEnterDelay={0}>
            <g>
              {/* Full-height hit area so thin bars are easy to hover. */}
              <rect x={x - GAP / 2} y={0} width={BAR + GAP} height={HEIGHT} fill="transparent" />
              <rect
                x={x}
                y={HEIGHT - h}
                width={BAR}
                height={h}
                rx={1.5}
                fill={color}
                // The current week is still in progress, so it is drawn faded.
                opacity={!v ? 0.2 : last ? 0.55 : 0.75}
              />
            </g>
          </Tooltip>
        );
      })}
    </svg>
  );
};

export default Sparkline;
