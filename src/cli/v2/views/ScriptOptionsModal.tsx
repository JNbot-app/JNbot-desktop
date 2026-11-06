import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { clipText } from '../components/Header';
import type { CliRuntime, RunItem, RunnableScript } from '../types';
import { groupScriptsByKind, type ScriptKind } from '../../../common/scriptKinds';
import {
  getRunnableScripts,
  getScriptOptionSchema,
  saveScriptOptions,
  runPlugin,
  runScript,
} from '../actions';
import { MultiSelectModal } from './MultiSelectModal';
import { ListOptionModal } from './ListOptionModal';
import { AltRangeModal } from './AltRangeModal';

interface ScriptOptionsModalProps {
  runtime: CliRuntime;
  item: RunItem;
  width: number;
  height: number;
  onClose: (didRun?: boolean) => void;
  onNotice: (msg: string) => void;
}

type FlatOption = {
  id: string;
  label: string;
  type: string;
  sectionName: string;
  defaultValue?: any;
  valueByFieldId?: string;
  options?: any[];
  gamemodes?: string[];
  fields?: any[];
  multiple?: boolean;
  freeSolo?: boolean;
  min?: number;
  max?: number;
  step?: number;
  inputType?: string;
  kinds?: ScriptKind[];
};

const isSingleChoice = (opt: FlatOption) =>
  opt.type === 'select' ||
  opt.type === 'altSelect' ||
  (['gamemodeSelect', 'activeBotSelect', 'scriptSelect'].includes(opt.type) && !opt.multiple);

const isMultiChoice = (opt: FlatOption) =>
  ['altsSelect', 'tagsSelect', 'multiSelect'].includes(opt.type) ||
  (['gamemodeSelect', 'activeBotSelect', 'scriptSelect'].includes(opt.type) && !!opt.multiple);

export const ScriptOptionsModal: React.FC<ScriptOptionsModalProps> = ({
  runtime,
  item,
  width,
  height,
  onClose,
  onNotice,
}) => {
  const [loading, setLoading] = useState(true);
  const [flatOptions, setFlatOptions] = useState<FlatOption[]>([]);
  const [scripts, setScripts] = useState<RunnableScript[]>([]);
  const [values, setValues] = useState<Record<string, any>>({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activePicker, setActivePicker] = useState<{ type: 'multi' | 'list' | 'range'; opt: FlatOption } | null>(null);

  const profileKey = runtime.handler.getBootstrapRuntime().profileKey;
  const jndata = runtime.handler.settings.JNdata;

  const serverGamemodes = useMemo(() => {
    const gmObj = jndata?.servers?.[profileKey];
    if (gmObj && typeof gmObj === 'object') return Object.keys(gmObj);
    return ['survival', 'skyblock', 'factions', 'prison', 'lifesteal'];
  }, [jndata, profileKey]);

  const altsList = useMemo(() => {
    return runtime.handler.settings.getAltsWithDataForProfile(profileKey).map((a) => a.username);
  }, [runtime, profileKey]);

  const activeBotsList = useMemo(() => {
    const bots = Object.values(runtime.handler.getBootstrapRuntime().activeBots.bots);
    return bots.map((b) => b.botInfo.username);
  }, [runtime]);

  const tagsList = useMemo(() => {
    const settings = runtime.handler.settings.getProfileSettings(profileKey);
    const tags = (settings?.tags ?? settings?.altTags ?? []) as Array<{ id: string; name?: string; label?: string }>;
    if (Array.isArray(tags) && tags.length > 0) {
      return tags.map((t) => ({ id: t.id, label: t.name || t.label || t.id }));
    }
    return [];
  }, [runtime, profileKey]);

  const scriptChoices = (opt: FlatOption) =>
    groupScriptsByKind(scripts, opt.kinds).flatMap((group) =>
      group.scripts.map(({ info }) => ({
        label: `${info.name} (${group.label})`,
        value: info.pluginId,
      })),
    );

  const scriptName = (id: string) =>
    scripts.find(({ info }) => info.pluginId === id)?.info.name ?? id;

  const optionById = useMemo(() => {
    const map: Record<string, FlatOption> = {};
    for (const opt of flatOptions) map[opt.id] = opt;
    return map;
  }, [flatOptions]);

  // Total nav items: options + [ Run Now ] + [ Save Options ] + [ Cancel ]
  const totalNavItems = flatOptions.length + 3;

  useEffect(() => {
    let cancelled = false;
    getScriptOptionSchema(runtime, item.id).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) {
        const flat: FlatOption[] = [];
        for (const section of result.data.sections ?? []) {
          for (const opt of section.options ?? []) {
            flat.push({
              id: opt.id,
              label: opt.label || opt.id,
              type: opt.type,
              sectionName: section.name || 'General',
              defaultValue: opt.defaultValue,
              valueByFieldId: opt.valueByFieldId,
              options: opt.options,
              gamemodes: opt.gamemodes,
              fields: opt.fields,
              multiple: opt.multiple,
              freeSolo: opt.freeSolo,
              min: opt.min,
              max: opt.max,
              step: opt.step || 1,
              inputType: opt.inputType,
              kinds: opt.kinds,
            });
          }
        }
        setFlatOptions(flat);
        setValues(result.data.values || {});
        if (flat.some((opt) => opt.type === 'scriptSelect')) {
          void getRunnableScripts(runtime).then((list) => {
            if (!cancelled) setScripts(list);
          });
        }
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [item.id, runtime]);

  const getDependencyKey = (opt: FlatOption): string | undefined => {
    if (!opt.valueByFieldId) return undefined;
    const parent = optionById[opt.valueByFieldId];
    if (!parent) return undefined;
    const parentVal = values[parent.id] ?? parent.defaultValue;
    if (parentVal === undefined || parentVal === null || parentVal === '') return undefined;
    return String(parentVal).toLowerCase();
  };

  const getOptionValue = (opt: FlatOption): any => {
    const depKey = getDependencyKey(opt);
    const stored = values[opt.id];
    if (depKey) {
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        return stored[depKey] !== undefined ? stored[depKey] : opt.defaultValue;
      }
    }
    return stored !== undefined ? stored : opt.defaultValue;
  };

  const updateOptionValue = (opt: FlatOption, newVal: any) => {
    const depKey = getDependencyKey(opt);
    if (depKey) {
      const prevObj =
        values[opt.id] && typeof values[opt.id] === 'object' && !Array.isArray(values[opt.id])
          ? values[opt.id]
          : {};
      setValues((prev) => ({
        ...prev,
        [opt.id]: {
          ...prevObj,
          [depKey]: newVal,
        },
      }));
    } else {
      setValues((prev) => ({
        ...prev,
        [opt.id]: newVal,
      }));
    }
  };

  const handleSave = async () => {
    await saveScriptOptions(runtime, item.id, values);
    onNotice(`Saved options for ${item.name}.`);
    onClose();
  };

  const handleRun = async () => {
    await saveScriptOptions(runtime, item.id, values);
    const result =
      item.type === 'script'
        ? await runScript(runtime, item.id)
        : await runPlugin(runtime, item.id);
    if (result.ok) {
      onNotice(`Started ${item.name}.`);
      onClose(true); // Redirect to dashboard!
    } else {
      onNotice(result.error || `Failed to run ${item.name}.`);
      onClose(false);
    }
  };

  useInput((input, key) => {
    if (activePicker) return;

    if (key.escape) {
      onClose();
      return;
    }

    const currentOpt = selectedIndex < flatOptions.length ? flatOptions[selectedIndex] : null;
    const isEditingInput = currentOpt?.type === 'input';

    if (!isEditingInput) {
      if (input === 'r') {
        void handleRun();
        return;
      }
      if (input === 's') {
        void handleSave();
        return;
      }
    }

    if (key.downArrow) {
      setSelectedIndex((idx) => Math.min(idx + 1, totalNavItems - 1));
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((idx) => Math.max(0, idx - 1));
      return;
    }

    // Action buttons at bottom
    if (selectedIndex === flatOptions.length) {
      if (key.return) void handleRun();
      return;
    }
    if (selectedIndex === flatOptions.length + 1) {
      if (key.return) void handleSave();
      return;
    }
    if (selectedIndex === flatOptions.length + 2) {
      if (key.return) onClose();
      return;
    }

    // Option editing
    if (currentOpt) {
      const currentVal = getOptionValue(currentOpt);

      if (currentOpt.type === 'switch') {
        if (input === ' ' || key.return || key.leftArrow || key.rightArrow) {
          updateOptionValue(currentOpt, !currentVal);
        }
      } else if (isSingleChoice(currentOpt)) {
        let choices: Array<{ label: string; value: any }> = [];
        if (currentOpt.type === 'select') {
          choices = currentOpt.options || [];
        } else if (currentOpt.type === 'gamemodeSelect') {
          choices = (currentOpt.gamemodes && currentOpt.gamemodes.length ? currentOpt.gamemodes : serverGamemodes).map(
            (gm) => ({ label: gm, value: gm }),
          );
        } else if (currentOpt.type === 'altSelect') {
          choices = altsList.map((alt) => ({ label: alt, value: alt }));
        } else if (currentOpt.type === 'activeBotSelect') {
          const bots = activeBotsList.length ? activeBotsList : altsList;
          choices = bots.map((b) => ({ label: b, value: b }));
        } else if (currentOpt.type === 'scriptSelect') {
          choices = scriptChoices(currentOpt);
        }

        if (choices.length > 0) {
          const currentIdx = choices.findIndex((c) => String(c.value) === String(currentVal));
          if (key.rightArrow || input === ' ') {
            const nextIdx = (currentIdx + 1 + choices.length) % choices.length;
            updateOptionValue(currentOpt, choices[nextIdx].value);
          } else if (key.leftArrow) {
            const prevIdx = (currentIdx - 1 + choices.length) % choices.length;
            updateOptionValue(currentOpt, choices[prevIdx].value);
          }
        }
      } else if (isMultiChoice(currentOpt)) {
        // Open MultiSelect Modal picker on Enter or Space!
        if (key.return || input === ' ') {
          setActivePicker({ type: 'multi', opt: currentOpt });
        }
      } else if (currentOpt.type === 'list') {
        // Open List Editor Modal on Enter!
        if (key.return) {
          setActivePicker({ type: 'list', opt: currentOpt });
        }
      } else if (currentOpt.type === 'altRange') {
        // Open dedicated AltRangeModal on Enter or Space!
        if (key.return || input === ' ' || key.leftArrow || key.rightArrow) {
          setActivePicker({ type: 'range', opt: currentOpt });
        }
      } else if (currentOpt.type === 'slider') {
        const min = currentOpt.min ?? 0;
        const max = currentOpt.max ?? 100;
        const step = currentOpt.step ?? 1;
        const numVal = Number(currentVal ?? min);
        if (key.rightArrow) {
          const nextVal = Math.min(max, numVal + step);
          updateOptionValue(currentOpt, nextVal);
        } else if (key.leftArrow) {
          const prevVal = Math.max(min, numVal - step);
          updateOptionValue(currentOpt, prevVal);
        }
      } else if (currentOpt.type === 'input') {
        if (key.backspace || key.delete) {
          const strVal = String(currentVal ?? '');
          updateOptionValue(currentOpt, strVal.slice(0, -1));
        } else if (input && !key.ctrl && !key.meta) {
          const strVal = String(currentVal ?? '');
          updateOptionValue(currentOpt, strVal + input);
        }
      }
    }
  });

  if (activePicker?.type === 'multi') {
    const opt = activePicker.opt;
    let items: Array<{ id: string; label: string }> = [];
    if (opt.type === 'altsSelect') {
      items = altsList.map((a) => ({ id: a, label: a }));
    } else if (opt.type === 'tagsSelect') {
      items = tagsList.length ? tagsList : [{ id: 'none', label: 'No tags defined in profile' }];
    } else if (opt.type === 'activeBotSelect') {
      const bots = activeBotsList.length ? activeBotsList : altsList;
      items = bots.map((b) => ({ id: b, label: b }));
    } else if (opt.type === 'scriptSelect') {
      items = scriptChoices(opt).map(({ label, value }) => ({ id: value, label }));
    } else if (opt.type === 'gamemodeSelect') {
      const gms = opt.gamemodes && opt.gamemodes.length ? opt.gamemodes : serverGamemodes;
      items = gms.map((gm) => ({ id: gm, label: gm }));
    } else {
      items = (opt.options || []).map((o) =>
        typeof o === 'string' ? { id: o, label: o } : { id: String(o.value), label: o.label || String(o.value) },
      );
    }

    const currentVal = getOptionValue(opt);
    const currentSelected = Array.isArray(currentVal)
      ? currentVal.map(String)
      : typeof currentVal === 'string' && currentVal.length > 0
        ? [currentVal]
        : [];

    return (
      <MultiSelectModal
        title={`Select: ${opt.label}`}
        items={items}
        initialSelected={currentSelected}
        freeSolo={opt.freeSolo}
        width={width}
        height={height}
        onSave={(selected) => {
          updateOptionValue(opt, selected);
          setActivePicker(null);
        }}
        onCancel={() => setActivePicker(null)}
      />
    );
  }

  if (activePicker?.type === 'range') {
    const opt = activePicker.opt;
    const currentVal = getOptionValue(opt);
    return (
      <AltRangeModal
        title={opt.label}
        alts={altsList}
        initialValue={Array.isArray(currentVal) ? currentVal : undefined}
        width={width}
        height={height}
        onSave={(range) => {
          updateOptionValue(opt, range);
          setActivePicker(null);
        }}
        onCancel={() => setActivePicker(null)}
      />
    );
  }

  if (activePicker?.type === 'list') {
    const opt = activePicker.opt;
    const currentRows = Array.isArray(getOptionValue(opt)) ? getOptionValue(opt) : [];

    return (
      <ListOptionModal
        title={`Edit List: ${opt.label}`}
        fields={opt.fields || [{ key: 'value', label: 'Value', type: 'input' }]}
        initialRows={currentRows}
        width={width}
        height={height}
        onSave={(rows) => {
          updateOptionValue(opt, rows);
          setActivePicker(null);
        }}
        onCancel={() => setActivePicker(null)}
      />
    );
  }

  const contentHeight = Math.max(6, height - 6);
  const optionWindowSize = Math.max(3, contentHeight - 7);
  const startOptionIdx = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(optionWindowSize / 2), Math.max(0, flatOptions.length - optionWindowSize)),
  );
  const visibleOptions = flatOptions.slice(startOptionIdx, startOptionIdx + optionWindowSize);

  const activeOpt = selectedIndex < flatOptions.length ? flatOptions[selectedIndex] : null;

  // Helper text for the current option
  let helperText = '↑↓ choose · Enter on button · Esc close';
  if (activeOpt) {
    if (activeOpt.type === 'switch') {
      helperText = 'Space / Enter / ← →: toggle [X] Enabled / [ ] Disabled';
    } else if (isSingleChoice(activeOpt)) {
      helperText = '← → or Space: cycle through available choices';
    } else if (activeOpt.type === 'slider') {
      helperText = `← →: adjust numeric value (min: ${activeOpt.min ?? 0}, max: ${activeOpt.max ?? 100})`;
    } else if (activeOpt.type === 'input') {
      helperText = 'Type text · Backspace deletes · Down arrow confirms';
    } else if (isMultiChoice(activeOpt)) {
      helperText = 'Enter / Space: open selector to check/uncheck items';
    } else if (activeOpt.type === 'list') {
      helperText = 'Enter: open list editor to add, edit, or delete items';
    } else if (activeOpt.type === 'altRange') {
      helperText = '← →: adjust alt range start and end';
    }
  }

  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor="cyan">
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          Configure: {clipText(item.name, Math.max(20, width - 25))}
        </Text>
        <Text dimColor>{item.type}</Text>
      </Box>

      {loading ? (
        <Text dimColor>Loading options…</Text>
      ) : flatOptions.length === 0 ? (
        <Box flexDirection="column" marginY={1}>
          <Text dimColor>No custom settings schema defined for this {item.type}.</Text>
          <Text dimColor>You can run this script directly below.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginY={0}>
          {visibleOptions.map((opt, offset) => {
            const actualIdx = startOptionIdx + offset;
            const isSelected = selectedIndex === actualIdx;
            const currentVal = getOptionValue(opt);

            let displayVal = '';
            if (opt.type === 'switch') {
              displayVal = currentVal ? '[X] Enabled' : '[ ] Disabled';
            } else if (opt.inputType === 'password') {
              displayVal = '********';
            } else if (isSingleChoice(opt)) {
              const shown = opt.type === 'scriptSelect' && currentVal ? scriptName(currentVal) : currentVal;
              displayVal = `← ${shown ?? 'None'} →`;
            } else if (opt.type === 'slider') {
              displayVal = `← ${currentVal ?? opt.min ?? 0} →`;
            } else if (isMultiChoice(opt)) {
              const arr = Array.isArray(currentVal)
                ? currentVal
                : typeof currentVal === 'string' && currentVal.length > 0
                  ? [currentVal]
                  : [];
              const names = opt.type === 'scriptSelect' ? arr.map(scriptName) : arr;
              displayVal = arr.length ? `[${arr.length} selected: ${names.slice(0, 2).join(', ')}${arr.length > 2 ? '…' : ''}]` : '(none selected)';
            } else if (opt.type === 'list') {
              const rows = Array.isArray(currentVal) ? currentVal : [];
              displayVal = `[${rows.length} row(s) · Enter to edit]`;
            } else if (opt.type === 'altRange') {
              const range = (Array.isArray(currentVal) ? currentVal : []) as [string?, string?];
              displayVal = `[${range[0] || 'First'} → ${range[1] || 'Last'}]`;
            } else if (opt.type === 'coordinate') {
              const coord = (typeof currentVal === 'object' && currentVal !== null) ? currentVal : {};
              displayVal = `X:${coord.x ?? 0} Y:${coord.y ?? 0} Z:${coord.z ?? 0}`;
            } else if (Array.isArray(currentVal)) {
              displayVal = currentVal.length ? currentVal.join(', ') : '(none)';
            } else {
              displayVal = String(currentVal ?? '');
            }

            return (
              <Box key={opt.id} justifyContent="space-between">
                <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                  {isSelected ? '› ' : '  '}
                  {clipText(opt.label, Math.max(16, Math.floor(width * 0.45)))}
                </Text>
                <Text color={isSelected ? 'yellow' : 'white'}>
                  {clipText(displayVal, Math.max(12, Math.floor(width * 0.45)))}
                  {opt.type === 'input' && isSelected ? <Text inverse> </Text> : null}
                </Text>
              </Box>
            );
          })}
          {flatOptions.length > optionWindowSize ? (
            <Text dimColor>
              {startOptionIdx + 1}–{Math.min(flatOptions.length, startOptionIdx + optionWindowSize)} of {flatOptions.length}
            </Text>
          ) : null}
        </Box>
      )}

      {/* Action Buttons */}
      <Box justifyContent="space-around" marginTop={1}>
        <Text
          color={selectedIndex === flatOptions.length ? 'black' : 'green'}
          backgroundColor={selectedIndex === flatOptions.length ? 'green' : undefined}
          bold
        >
          [ Run Script (r) ]
        </Text>
        <Text
          color={selectedIndex === flatOptions.length + 1 ? 'black' : 'cyan'}
          backgroundColor={selectedIndex === flatOptions.length + 1 ? 'cyan' : undefined}
          bold
        >
          [ Save Options (s) ]
        </Text>
        <Text
          color={selectedIndex === flatOptions.length + 2 ? 'black' : 'gray'}
          backgroundColor={selectedIndex === flatOptions.length + 2 ? 'gray' : undefined}
        >
          [ Cancel (Esc) ]
        </Text>
      </Box>

      {/* Helper Legend */}
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="cyan">{helperText}</Text>
      </Box>
    </Box>
  );
};
