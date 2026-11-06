import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import {
  useSettingsStore,
  updateScriptSettings,
  selectSettings,
} from '../../../redux/settings';
import {
  ScriptSettingProps,
  ScriptSettingsSection,
} from './ScriptSettingsProps.d';
import Option from './SettingOptions/Option';
import { Collapse, Form } from 'antd';
import { presetValues } from '../../../../common/pluginPresets';

const ScriptSettings: FC<{
  /** Option schema, grouped into collapsible sections. */
  options: ScriptSettingsSection[] | null;
  /** Storage key in `settings.scripts` — always the plugin id. */
  scriptName: string;
  className?: string;
  /**
   * Field-keyed error messages raised by `script.optionError(...)`. Each
   * matching field renders with AntD error styling and the message below.
   */
  errors?: Record<string, string>;
  /** Called when a user changes a field, so the caller can drop the error. */
  onClearError?: (field: string) => void;
}> = ({ options: sections, scriptName, className, errors, onClearError }) => {
  const settings = useSettingsStore(selectSettings);
  const [form] = Form.useForm();

  const sourceSettings = useMemo(
    () => presetValues(settings.scripts?.[scriptName]),
    [settings, scriptName],
  );

  const optionById = useMemo(() => {
    const map: Record<string, ScriptSettingProps> = {};
    for (const section of sections ?? []) {
      for (const option of section.options) {
        map[option.id] = option;
      }
    }
    return map;
  }, [sections]);

  const getDependencyKey = useCallback(
    (option: ScriptSettingProps) => {
      const dependencyFieldId = option.valueByFieldId;
      if (!dependencyFieldId) return undefined;

      const dependencyOption = optionById[dependencyFieldId];
      if (!dependencyOption) return undefined;

      const dependencyValue =
        sourceSettings[dependencyOption.id] ?? dependencyOption.defaultValue;
      if (
        dependencyValue === undefined ||
        dependencyValue === null ||
        dependencyValue === ''
      ) {
        return undefined;
      }

      return String(dependencyValue).toLowerCase();
    },
    [optionById, sourceSettings],
  );

  // Reverse index: field id -> options that derive their value from it.
  const dependentsByFieldId = useMemo(() => {
    const map: Record<string, ScriptSettingProps[]> = {};
    for (const section of sections ?? []) {
      for (const option of section.options) {
        if (option.valueByFieldId) {
          (map[option.valueByFieldId] ??= []).push(option);
        }
      }
    }
    return map;
  }, [sections]);

  const getSettingValue = useCallback(
    (option: ScriptSettingProps) => {
      const dependencyKey = getDependencyKey(option);

      const storedValue = sourceSettings[option.id];

      if (dependencyKey) {
        if (
          storedValue &&
          typeof storedValue === 'object' &&
          !Array.isArray(storedValue)
        ) {
          return storedValue[dependencyKey] !== undefined
            ? storedValue[dependencyKey]
            : option.defaultValue;
        }
      }
      return storedValue !== undefined ? storedValue : option.defaultValue;
    },
    [getDependencyKey, sourceSettings],
  );

  const onChange = useCallback(
    (value: any, option: ScriptSettingProps) => {
      form.setFields([{ name: option.id, errors: [] }]);
      onClearError?.(option.id);

      const dependencyKey = getDependencyKey(option);

      if (dependencyKey) {
        if (sourceSettings[option.id]?.[dependencyKey] === value) return;

        updateScriptSettings({
          optionId: option.id,
          value: { [dependencyKey]: value },
          scriptName,
        });
      } else {
        if (sourceSettings[option.id] === value) return;

        updateScriptSettings({ optionId: option.id, value, scriptName });
      }

      // Re-sync any fields that key their value off the field that just
      // changed. The AntD form store controls these inputs, so refreshing
      // redux isn't enough — we push the value for the new dependency key
      // directly into the store, touching only the dependent fields.
      const dependents = dependentsByFieldId[option.id];
      if (dependents?.length) {
        const newKey =
          value === undefined || value === null || value === ''
            ? undefined
            : String(value).toLowerCase();

        form.setFields(
          dependents.map((dependent) => {
            const stored = sourceSettings[dependent.id];
            let next = dependent.defaultValue;
            if (
              newKey &&
              stored &&
              typeof stored === 'object' &&
              !Array.isArray(stored) &&
              stored[newKey] !== undefined
            ) {
              next = stored[newKey];
            }
            return { name: dependent.id, value: next };
          }),
        );
      }
    },
    [
      scriptName,
      sourceSettings,
      getDependencyKey,
      onClearError,
      form,
      dependentsByFieldId,
    ],
  );

  const optionValues = useMemo(() => {
    const obj: Record<string, any> = {};
    for (const section of sections ?? []) {
      for (const option of section.options) {
        obj[option.id] = getSettingValue(option);
      }
    }
    return obj;
  }, [sections, getSettingValue]);

  const [activeSections, setActiveSections] = useState<string[]>(() =>
    (sections ?? []).filter((s) => !s.collapsed).map((s) => s.name),
  );

  // Push errors into the Form, expand sections that contain errored fields,
  // and scroll the first error into view.
  useEffect(() => {
    if (!sections || !errors) return;
    const entries = Object.entries(errors);
    if (entries.length === 0) return;

    const sectionsToOpen = sections
      .filter((s) => s.options.some((o) => errors[o.id]))
      .map((s) => s.name);

    if (sectionsToOpen.length > 0) {
      setActiveSections((prev) =>
        Array.from(new Set([...prev, ...sectionsToOpen])),
      );
    }

    const firstField = entries[0]?.[0];
    if (firstField) {
      setTimeout(() => {
        try {
          form.scrollToField(firstField, {
            behavior: 'smooth',
            block: 'center',
          });
        } catch {
          /* ignore */
        }
      }, 250);
    }

    setTimeout(() => {
      form.setFields(
        entries.map(([name, message]) => ({ name, errors: [message] })),
      );
    }, 250);
  }, [errors, form, sections]);

  if (!sections) return null;

  return (
    <Form
      form={form}
      style={{ height: '100%' }}
      layout="vertical"
      initialValues={optionValues}
    >
      <Collapse
        className={className}
        style={{ width: '100%' }}
        activeKey={activeSections}
        onChange={(keys) =>
          setActiveSections(Array.isArray(keys) ? keys : [keys])
        }
        items={sections.map((section) => ({
          label: section.name,
          key: section.name,
          className: section.className,
          children: (
            <div className={section.className}>
              {section.options.map((option) => {
                if (option.visible && !option.visible(sourceSettings)) {
                  return null;
                }

                const resolvedOption =
                  'options' in option && typeof option.options === 'function'
                    ? {
                        ...option,
                        options: option.options(settings) as any,
                      }
                    : option;

                return (
                  <Option
                    key={resolvedOption.id}
                    option={resolvedOption}
                    onChange={onChange}
                    value={getSettingValue(resolvedOption)}
                  />
                );
              })}
            </div>
          ),
        }))}
      />
    </Form>
  );
};

export default ScriptSettings;
