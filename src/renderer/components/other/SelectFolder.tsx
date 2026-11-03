import React from 'react';
import { Button, Input } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import type { SelectDirectoryResult } from '../../../main/src/platform/PlatformAdapter';

interface SelectFolderProps {
  onChange: (value: string) => void;
  value?: string;
  inputProps?: any;
  id: string;
  defaultValue?: string;
  label: string;
}

const SelectFolder: React.FC<SelectFolderProps> = ({
  onChange,
  value,
  inputProps = {},
  id,
  defaultValue,
  label,
  ...props
}) => {
  if (!id) return null;

  const selectFile = async () => {
    const directory =
      await window.ipcRenderer.get<SelectDirectoryResult>('SELECT_DIRECTORY');
    if (directory.canceled || !directory.path) return;
    const el = document.getElementById(id);
    if (el instanceof HTMLInputElement) el.value = directory.path;
    onChange(directory.path);
  };

  return (
    <div {...props} style={{ position: 'relative', maxWidth: '400px' }}>
      <label htmlFor={id} style={{ display: 'block', marginBottom: '8px' }}>
        {label}
      </label>
      <Input
        defaultValue={defaultValue}
        value={value}
        id={id}
        onBlur={(e) => {
          if (e.target.value !== value) {
            onChange(e.target.value);
          }
        }}
        {...inputProps}
        suffix={<Button icon={<FolderOpenOutlined />} onClick={selectFile} />}
      />
    </div>
  );
};

export default SelectFolder;
