import React, { memo } from 'react';
import Anser from 'anser';

type AnserChunk = {
  content: string;
  fg: string | null;
  bg: string | null;
  decoration:
    | 'bold'
    | 'dim'
    | 'italic'
    | 'underline'
    | 'strikethrough'
    | null;
};

export interface AnsiTextProps {
  children: string;
  className?: string;
  style?: React.CSSProperties;
}

function toRgb(value: string | null): string | undefined {
  if (!value) return undefined;
  return `rgb(${value})`;
}

function decorationStyle(decoration: AnserChunk['decoration']): React.CSSProperties {
  switch (decoration) {
    case 'bold':
      return { fontWeight: 700 };
    case 'dim':
      return { opacity: 0.8 };
    case 'italic':
      return { fontStyle: 'italic' };
    case 'underline':
      return { textDecorationLine: 'underline' };
    case 'strikethrough':
      return { textDecorationLine: 'line-through' };
    default:
      return {};
  }
}

const AnsiText: React.FC<AnsiTextProps> = memo(({ children, className, style }) => {
  const text = children ?? '';
  const chunks = Anser.ansiToJson(text) as unknown as AnserChunk[];

  return (
    <span className={className} style={{ whiteSpace: 'pre-wrap', ...(style ?? {}) }}>
      {chunks.map((chunk, index) => {
        if (!chunk?.content) return null;
        return (
          <span
            // Stable enough for streaming logs; content can repeat so include index
            key={`${index}-${chunk.content}`}
            style={{
              color: toRgb(chunk.fg),
              backgroundColor: toRgb(chunk.bg),
              ...decorationStyle(chunk.decoration),
            }}
          >
            {chunk.content}
          </span>
        );
      })}
    </span>
  );
});

export default AnsiText;
