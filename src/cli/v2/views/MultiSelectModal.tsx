import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { clipText } from '../components/Header';

interface MultiSelectModalProps {
  title: string;
  items: Array<{ id: string; label: string }>;
  initialSelected: string[];
  freeSolo?: boolean;
  width: number;
  height: number;
  onSave: (selected: string[]) => void;
  onCancel: () => void;
}

export const MultiSelectModal: React.FC<MultiSelectModalProps> = ({
  title,
  items: baseItems,
  initialSelected,
  freeSolo = false,
  width,
  height,
  onSave,
  onCancel,
}) => {
  // Discover any initially selected values that are not in baseItems
  const initialCustom = (initialSelected || [])
    .filter((id) => !baseItems.some((i) => i.id === id))
    .map((id) => ({ id, label: id }));

  const [customItems, setCustomItems] = useState<Array<{ id: string; label: string }>>(initialCustom);
  const [selected, setSelected] = useState<string[]>(initialSelected || []);
  const [cursor, setCursor] = useState(0);

  // Freeform input state
  const [isTypingCustom, setIsTypingCustom] = useState(false);
  const [customInputText, setCustomInputText] = useState('');

  const allItems = [...baseItems, ...customItems];

  const limit = Math.max(4, height - (freeSolo ? 11 : 9));
  const start = Math.max(0, Math.min(cursor - Math.floor(limit / 2), Math.max(0, allItems.length - limit)));
  const visible = allItems.slice(start, start + limit);

  useInput((input, key) => {
    // Mode 1: Typing a custom freeSolo value
    if (isTypingCustom) {
      if (key.escape) {
        setIsTypingCustom(false);
        setCustomInputText('');
        return;
      }
      if (key.return) {
        const val = customInputText.trim();
        if (val) {
          if (!allItems.some((i) => i.id === val)) {
            setCustomItems((prev) => [...prev, { id: val, label: val }]);
          }
          if (!selected.includes(val)) {
            setSelected((prev) => [...prev, val]);
          }
          setCustomInputText('');
          setIsTypingCustom(false);
          setCursor(allItems.length); // point to the new item
        }
        return;
      }
      if (key.backspace || key.delete) {
        setCustomInputText((t) => t.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setCustomInputText((t) => t + input);
        return;
      }
      return;
    }

    // Mode 2: Browsing & toggling items
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      onSave(selected);
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(c + 1, Math.max(0, allItems.length - 1)));
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (input === ' ') {
      const hovered = allItems[cursor];
      if (hovered) {
        setSelected((prev) =>
          prev.includes(hovered.id)
            ? prev.filter((id) => id !== hovered.id)
            : [...prev, hovered.id],
        );
      }
      return;
    }
    if (input === 'a') {
      // Toggle select all / deselect all
      if (selected.length === allItems.length) {
        setSelected([]);
      } else {
        setSelected(allItems.map((i) => i.id));
      }
      return;
    }
    if (freeSolo && (input === 'n' || input === 't')) {
      setIsTypingCustom(true);
      setCustomInputText('');
      return;
    }
    if ((input === 'd' || key.delete) && allItems[cursor]) {
      const hovered = allItems[cursor];
      // Only remove if it's a custom item
      if (customItems.some((i) => i.id === hovered.id)) {
        setCustomItems((prev) => prev.filter((i) => i.id !== hovered.id));
        setSelected((prev) => prev.filter((id) => id !== hovered.id));
        setCursor((c) => Math.max(0, c - 1));
      }
      return;
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          {title} ({selected.length}/{allItems.length} selected)
        </Text>
        <Text dimColor>
          Space toggle · [a] all · {freeSolo ? '[n] custom · ' : ''}Enter confirm · Esc cancel
        </Text>
      </Box>

      {allItems.length === 0 ? (
        <Box flexDirection="column" marginY={1}>
          <Text dimColor>No items available to select.</Text>
          {freeSolo ? (
            <Text color="cyan">Press [n] to add a custom value.</Text>
          ) : null}
        </Box>
      ) : (
        <Box flexDirection="column">
          {visible.map((item, idx) => {
            const actualIdx = start + idx;
            const isHovered = cursor === actualIdx;
            const isChecked = selected.includes(item.id);
            const isCustom = customItems.some((c) => c.id === item.id);

            return (
              <Box key={item.id} justifyContent="space-between">
                <Text color={isHovered ? 'cyan' : undefined} bold={isHovered}>
                  {isHovered ? '› ' : '  '}
                  {isChecked ? (
                    <Text color="green">[X] </Text>
                  ) : (
                    <Text color="gray">[ ] </Text>
                  )}
                  {clipText(item.label, Math.max(16, Math.floor(width * 0.55)))}
                  {isCustom ? <Text dimColor> (custom)</Text> : null}
                </Text>
                {isChecked ? <Text color="green">selected</Text> : null}
              </Box>
            );
          })}
          {allItems.length > visible.length ? (
            <Text dimColor>
              {start + 1}–{start + visible.length} of {allItems.length} (↑↓ scroll)
            </Text>
          ) : null}
        </Box>
      )}

      {/* Freeform input bar */}
      {freeSolo ? (
        <Box
          marginTop={1}
          borderStyle="single"
          borderColor={isTypingCustom ? 'yellow' : 'gray'}
          paddingX={1}
          justifyContent="space-between"
        >
          <Box gap={1}>
            <Text bold color={isTypingCustom ? 'yellow' : 'gray'}>
              + Add custom:
            </Text>
            {isTypingCustom ? (
              <Text color="yellow" bold>
                {customInputText}
                <Text inverse> </Text>
              </Text>
            ) : (
              <Text dimColor>Press [n] to type custom value</Text>
            )}
          </Box>
          {isTypingCustom ? (
            <Text dimColor>Enter add · Esc cancel</Text>
          ) : null}
        </Box>
      ) : null}

      <Box justifyContent="space-around" marginTop={1}>
        <Text bold color="green">[ Done (Enter) ]</Text>
        <Text color="gray">[ Cancel (Esc) ]</Text>
      </Box>
    </Box>
  );
};
