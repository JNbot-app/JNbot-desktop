import { FC, memo } from 'react';
import { Form } from 'antd';
import { useRunnableScripts } from '../../../../hooks/useRunnableScripts';
import ScriptSelect from '../ScriptSelect';
import {
  ScriptSettingProps,
  ScriptSettingsProps_ScriptSelect,
} from '../ScriptSettingsProps.d';

const ScriptSelectOption: FC<{
  option: ScriptSettingsProps_ScriptSelect;
  onChange?: (e: string | string[], option: ScriptSettingProps) => void;
}> = ({ option, onChange }) => {
  const { scripts, loading } = useRunnableScripts();
  const multiple = option.multiple === true;

  return (
    <Form.Item
      label={option.label}
      name={option.id}
      tooltip={option.tooltip}
      style={{ width: '100%', maxWidth: multiple ? 420 : 360 }}
    >
      <ScriptSelect
        id={option.id}
        scripts={scripts}
        kinds={option.kinds}
        multiple={multiple}
        loading={loading}
        allowClear={option.clearable !== false}
        placeholder={option.placeholder}
        className={option.className}
        onChange={(next?: string | string[]) =>
          onChange?.(next ?? (multiple ? [] : ''), option)
        }
      />
    </Form.Item>
  );
};

export default memo(ScriptSelectOption);
