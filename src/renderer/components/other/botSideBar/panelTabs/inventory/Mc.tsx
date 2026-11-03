import React, { memo, CSSProperties } from 'react';
import PropTypes from 'prop-types';
import AnsiText from '../../../../common/AnsiText';

const toAnsiColors: Record<string, string> = {
  "§0": "\x1b[30m",
  "§1": "\x1b[34m",
  "§2": "\x1b[32m",
  "§3": "\x1b[36m",
  "§4": "\x1b[31m",
  "§5": "\x1b[35m",
  "§6": "\x1b[33m",
  "§7": "\x1b[37m",
  "§8": "\x1b[90m",
  "§9": "\x1b[94m",
  "§a": "\x1b[92m",
  "§b": "\x1b[96m",
  "§c": "\x1b[91m",
  "§d": "\x1b[95m",
  "§e": "\x1b[93m",
  "§f": "\x1b[97m",
  "§k": "\x1b[8m",
  "§l": "\x1b[1m",
  "§m": "\x1b[9m",
  "§n": "\x1b[4m",
  "§o": "\x1b[3m",
  "§r": "\x1b[0m",
}


interface McProps {
  children: string;
  fontSize?: number;
  style?: CSSProperties;
}


function toAnsi(text: string): string {
  return text.replace(/§[0-9a-fklmnor]/g, (match) => toAnsiColors[match] ?? "")
}



const Mc: React.FC<McProps> = memo(({ children, fontSize = 15, style }) => {
  if (!children) return null;
  const ansi = toAnsi(children);


  return <McAnsiText text={ansi} fontSize={fontSize} style={style} />;
});

export const McAnsiText = memo(
  ({
    text,
    style,
    fontSize,
  }: {
    text: string;
    style?: CSSProperties;
    fontSize?: number;
  }) => {
    return (
      <span
      className='mc-font'
        style={{
          fontSize: fontSize ? fontSize + 'px': undefined,
          ...(style ?? {}),
        }}
      >
        <AnsiText>{text}</AnsiText>
      </span>
    );
  },
);

Mc.propTypes = {
  children: PropTypes.string.isRequired,
  fontSize: PropTypes.number,
  style: PropTypes.object,
};

export default Mc;
