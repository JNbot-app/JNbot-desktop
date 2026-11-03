import React, { useState } from 'react';
import { Flex } from 'antd';
import type { ScreenPrompt } from '../../../../../../main/src/workers/workerTypes';
import botEvents from '../../../../../utils/botEvents';
import { McAnsiText } from './Mc';

interface SignEditorProps {
  sign: Extract<ScreenPrompt, { kind: 'sign' }>;
  botId: number;
}

/** Sign text prompt opened by the server (e.g. Hypixel's "enter amount" signs). */
const SignEditor: React.FC<SignEditorProps> = ({ sign, botId }) => {
  const [lines, setLines] = useState(sign.lines);

  const submit = () => botEvents.action(botId, 'updateSign', lines);
  const setLine = (index: number, value: string) =>
    setLines((prev) => prev.map((line, i) => (i === index ? value : line)));

  return (
    <Flex vertical align="center" gap={16} style={{ padding: '1.5rem 0' }}>
      <McAnsiText
        text="Edit Sign Message"
        fontSize={16}
        style={{ color: '#3f3f3f' }}
      />
      <Flex vertical align="center">
        <div className="mc-sign">
          {lines.map((line, i) => (
            <input
              key={i}
              value={line}
              maxLength={45}
              autoFocus={i === 0}
              spellCheck={false}
              aria-label={`Sign line ${i + 1}`}
              onChange={(e) => setLine(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') submit();
                if (e.key !== 'Enter') return;
                const next = e.currentTarget.nextElementSibling;
                if (next instanceof HTMLInputElement) next.focus();
                else submit();
              }}
            />
          ))}
        </div>
        <div className="mc-sign-post" />
      </Flex>
      <button type="button" className="mc-button" onClick={submit}>
        Done
      </button>
    </Flex>
  );
};

export default SignEditor;
