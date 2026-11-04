import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { clipText } from '../components/Header';

interface AltRangeModalProps {
  title: string;
  alts: string[];
  initialValue?: [string | null, string | null];
  width: number;
  height: number;
  onSave: (range: [string | null, string | null]) => void;
  onCancel: () => void;
}

export const AltRangeModal: React.FC<AltRangeModalProps> = ({
  title,
  alts,
  initialValue,
  width,
  onSave,
  onCancel,
}) => {
  const [startAlt, setStartAlt] = useState<string | null>(initialValue?.[0] ?? null);
  const [endAlt, setEndAlt] = useState<string | null>(initialValue?.[1] ?? null);
  const [focusField, setFocusField] = useState<'start' | 'end'>('start');

  // Options for start: null (First) + alts
  const startChoices = [null, ...alts];
  // Options for end: alts + null (Last)
  const endChoices = [...alts, null];

  const currentStartIdx = startChoices.findIndex((a) => a === startAlt);
  const currentEndIdx = endChoices.findIndex((a) => a === endAlt);

  // Compute selected alts slice for live preview
  const resolvedStartIdx = startAlt ? alts.indexOf(startAlt) : 0;
  const resolvedEndIdx = endAlt ? alts.indexOf(endAlt) : alts.length - 1;

  const validStart = resolvedStartIdx >= 0 ? resolvedStartIdx : 0;
  const validEnd = resolvedEndIdx >= 0 ? resolvedEndIdx : alts.length - 1;

  const includedAlts =
    validStart <= validEnd
      ? alts.slice(validStart, validEnd + 1)
      : [];

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return || input === 's') {
      onSave([startAlt, endAlt]);
      return;
    }
    if (key.tab || key.upArrow || key.downArrow) {
      setFocusField((f) => (f === 'start' ? 'end' : 'start'));
      return;
    }

    if (focusField === 'start') {
      if (key.rightArrow) {
        const nextIdx = (currentStartIdx + 1) % startChoices.length;
        setStartAlt(startChoices[nextIdx]);
      } else if (key.leftArrow) {
        const prevIdx = (currentStartIdx - 1 + startChoices.length) % startChoices.length;
        setStartAlt(startChoices[prevIdx]);
      }
    } else {
      if (key.rightArrow) {
        const nextIdx = (currentEndIdx + 1) % endChoices.length;
        setEndAlt(endChoices[nextIdx]);
      } else if (key.leftArrow) {
        const prevIdx = (currentEndIdx - 1 + endChoices.length) % endChoices.length;
        setEndAlt(endChoices[prevIdx]);
      }
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          {title} (Alt Range)
        </Text>
        <Text dimColor>Tab/↑↓ switch field · ← → change alt · Enter confirm</Text>
      </Box>

      {/* Start Alt Row */}
      <Box justifyContent="space-between" paddingY={0}>
        <Text color={focusField === 'start' ? 'cyan' : undefined} bold={focusField === 'start'}>
          {focusField === 'start' ? '› ' : '  '}Start with:
        </Text>
        <Text color={focusField === 'start' ? 'yellow' : 'white'} bold={focusField === 'start'}>
          ← [ {startAlt ?? 'First alt (default)'} ] →
        </Text>
      </Box>

      {/* End Alt Row */}
      <Box justifyContent="space-between" paddingY={0}>
        <Text color={focusField === 'end' ? 'cyan' : undefined} bold={focusField === 'end'}>
          {focusField === 'end' ? '› ' : '  '}End with:
        </Text>
        <Text color={focusField === 'end' ? 'yellow' : 'white'} bold={focusField === 'end'}>
          ← [ {endAlt ?? 'Last alt (default)'} ] →
        </Text>
      </Box>

      {/* Live Preview Card */}
      <Box
        flexDirection="column"
        marginY={1}
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
      >
        <Text dimColor>Included alts ({includedAlts.length} total):</Text>
        <Text color="green">
          {includedAlts.length > 0
            ? clipText(includedAlts.join(', '), Math.max(20, width - 15))
            : '(No alts in selected range)'}
        </Text>
      </Box>

      <Box justifyContent="space-around" marginTop={1}>
        <Text bold color="green">[ Save &amp; Close (Enter) ]</Text>
        <Text color="gray">[ Cancel (Esc) ]</Text>
      </Box>
    </Box>
  );
};
