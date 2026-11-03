import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { clipText } from '../components/Header';

interface ListFieldDef {
  key: string;
  label?: string;
  type?: string;
  placeholder?: string;
  defaultValue?: any;
  options?: Array<{ label: string; value: any }>;
}

interface ListOptionModalProps {
  title: string;
  fields: ListFieldDef[];
  initialRows: Record<string, any>[];
  width: number;
  height: number;
  onSave: (rows: Record<string, any>[]) => void;
  onCancel: () => void;
}

export const ListOptionModal: React.FC<ListOptionModalProps> = ({
  title,
  fields,
  initialRows,
  width,
  height,
  onSave,
  onCancel,
}) => {
  const [rows, setRows] = useState<Record<string, any>[]>(initialRows || []);
  const [selectedRow, setSelectedRow] = useState(0);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editingFieldIndex, setEditingFieldIndex] = useState(0);

  const limit = Math.max(3, height - 10);
  const start = Math.max(0, Math.min(selectedRow - Math.floor(limit / 2), rows.length - limit));
  const visible = rows.slice(start, start + limit);

  useInput((input, key) => {
    // Sub-mode: Editing a specific row's fields
    if (editingRow !== null) {
      const activeField = fields[editingFieldIndex];
      if (key.escape) {
        setEditingRow(null);
        return;
      }
      if (key.tab || key.downArrow) {
        setEditingFieldIndex((i) => (i + 1) % fields.length);
        return;
      }
      if (key.upArrow) {
        setEditingFieldIndex((i) => (i - 1 + fields.length) % fields.length);
        return;
      }
      if (key.return) {
        setEditingRow(null);
        return;
      }

      if (activeField) {
        const row = rows[editingRow] || {};
        const fieldKey = activeField.key;
        const currentVal = row[fieldKey];

        if (activeField.type === 'switch') {
          if (input === ' ' || key.leftArrow || key.rightArrow) {
            setRows((prev) =>
              prev.map((r, i) => (i === editingRow ? { ...r, [fieldKey]: !currentVal } : r)),
            );
          }
        } else if (activeField.type === 'select' && activeField.options?.length) {
          const choices = activeField.options;
          const curIdx = choices.findIndex((c) => String(c.value) === String(currentVal));
          if (key.rightArrow || input === ' ') {
            const nextIdx = (curIdx + 1) % choices.length;
            setRows((prev) =>
              prev.map((r, i) => (i === editingRow ? { ...r, [fieldKey]: choices[nextIdx].value } : r)),
            );
          } else if (key.leftArrow) {
            const prevIdx = (curIdx - 1 + choices.length) % choices.length;
            setRows((prev) =>
              prev.map((r, i) => (i === editingRow ? { ...r, [fieldKey]: choices[prevIdx].value } : r)),
            );
          }
        } else {
          // text or number input
          if (key.backspace || key.delete) {
            const strVal = String(currentVal ?? '');
            setRows((prev) =>
              prev.map((r, i) => (i === editingRow ? { ...r, [fieldKey]: strVal.slice(0, -1) } : r)),
            );
          } else if (input && !key.ctrl && !key.meta) {
            const strVal = String(currentVal ?? '');
            setRows((prev) =>
              prev.map((r, i) => (i === editingRow ? { ...r, [fieldKey]: strVal + input } : r)),
            );
          }
        }
      }
      return;
    }

    // Main mode: Browsing list rows
    if (key.escape) {
      onSave(rows);
      return;
    }
    if (key.return) {
      if (rows[selectedRow]) {
        setEditingRow(selectedRow);
        setEditingFieldIndex(0);
      }
      return;
    }
    if (key.downArrow) {
      setSelectedRow((r) => Math.min(r + 1, Math.max(0, rows.length - 1)));
      return;
    }
    if (key.upArrow) {
      setSelectedRow((r) => Math.max(0, r - 1));
      return;
    }
    if (input === 'n') {
      // Add new row with default field values
      const newRow: Record<string, any> = {};
      for (const f of fields) {
        newRow[f.key] = f.defaultValue !== undefined ? f.defaultValue : '';
      }
      setRows((prev) => [...prev, newRow]);
      setSelectedRow(rows.length);
      setEditingRow(rows.length);
      setEditingFieldIndex(0);
      return;
    }
    if ((input === 'd' || key.delete) && rows[selectedRow]) {
      setRows((prev) => prev.filter((_, i) => i !== selectedRow));
      setSelectedRow((r) => Math.max(0, r - 1));
      return;
    }
    if (input === 's') {
      onSave(rows);
      return;
    }
  });

  const formatRowSummary = (row: Record<string, any>) => {
    return fields
      .map((f) => `${f.label || f.key}: ${row[f.key] ?? '-'}`)
      .join(' · ');
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          {title} ({rows.length} items)
        </Text>
        <Text dimColor>[n] add · [d] delete · Enter edit · Esc done</Text>
      </Box>

      {editingRow !== null && rows[editingRow] ? (
        <Box flexDirection="column" marginY={1} borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text bold color="yellow">Editing Item #{editingRow + 1}:</Text>
          {fields.map((f, fIdx) => {
            const isFSelected = editingFieldIndex === fIdx;
            const val = rows[editingRow][f.key];
            return (
              <Box key={f.key} justifyContent="space-between">
                <Text color={isFSelected ? 'cyan' : undefined} bold={isFSelected}>
                  {isFSelected ? '› ' : '  '}{f.label || f.key}:
                </Text>
                <Text color={isFSelected ? 'yellow' : 'white'}>
                  {String(val ?? '')}
                  {isFSelected ? <Text inverse> </Text> : null}
                </Text>
              </Box>
            );
          })}
          <Box marginTop={1}>
            <Text dimColor>Tab next field · Type to edit · Enter finish editing row</Text>
          </Box>
        </Box>
      ) : rows.length === 0 ? (
        <Box flexDirection="column" marginY={1}>
          <Text dimColor>List is empty.</Text>
          <Text color="cyan">Press [n] to add an item.</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {visible.map((row, idx) => {
            const actualIdx = start + idx;
            const isSelected = selectedRow === actualIdx;
            return (
              <Box key={actualIdx} justifyContent="space-between">
                <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                  {isSelected ? '› ' : '  '}[{actualIdx + 1}] {clipText(formatRowSummary(row), Math.max(20, width - 15))}
                </Text>
              </Box>
            );
          })}
          {rows.length > visible.length ? (
            <Text dimColor>
              {start + 1}–{start + visible.length} of {rows.length} (↑↓ scroll)
            </Text>
          ) : null}
        </Box>
      )}

      <Box justifyContent="space-around" marginTop={1}>
        <Text bold color="green">[ Save &amp; Close (Esc / s) ]</Text>
      </Box>
    </Box>
  );
};
