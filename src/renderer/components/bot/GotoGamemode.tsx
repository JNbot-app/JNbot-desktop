import React, { useState } from 'react';
import { Card, Form, Select, Button } from 'antd';
import botActionHandler from './botActionHandler';
import {
  useSettingsStore,
  selectJNDataByServer,
} from '../../redux/settings';
import useAppApi from '../../hooks/useAppApi';

const GotoGamemode: React.FC<{ withCard?: boolean }> = ({
  withCard = true,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const JNdata = useSettingsStore(selectJNDataByServer);
  const { message } = useAppApi();

  const parseLocalstorageItem = () => {
    const storage = window.localStorage.getItem('lastGamemode') || '{}';

    let parsed: Record<string, string> = {};
    try {
      parsed = JSON.parse(storage);
    } catch (err) {
      console.warn(
        'Failed to parse last gamemode from localStorage, using default gamemode',
      );
    }
    return parsed;
  };

  const defaultValue = () => {
    return (
      parseLocalstorageItem()[JNdata.server] || JNdata.data.defaultGamemode
    );
  };

  const [selectedGamemode, setSelectedGamemode] =
    useState<string>(defaultValue());

  const doAction = async () => {
    if (!selectedGamemode) return;
    setIsLoading(true);
    const response = await botActionHandler(
      'joinGamemode',
      selectedGamemode,
      true,
    );
    if (!document.getElementById('gamemode-select')) return;
    setIsLoading(false);
    if (response) message.success('Successfully joined ' + selectedGamemode);
  };
  const form = (
    <Form layout="vertical">
      <Form.Item label="Gamemode">
        <Select
          id="gamemode-select"
          onChange={(newGamemode) => {
            const currentStorage = parseLocalstorageItem();
            currentStorage[JNdata.server] = newGamemode;

            window.localStorage.setItem(
              'lastGamemode',
              JSON.stringify(currentStorage),
            );
            setSelectedGamemode(newGamemode);
          }}
          value={selectedGamemode}
          options={JNdata.data.gamemodes.map((gm) => ({
            label: gm,
            value: gm,
          }))}
        />
      </Form.Item>
      <Form.Item>
        <Button type="primary" loading={isLoading} onClick={doAction} block>
          Join gamemode
        </Button>
      </Form.Item>
    </Form>
  );
  if (!withCard) return form;
  return (
    <Card title="Goto Gamemode" style={{ maxWidth: '300px', width: '100%' }}>
      {form}
    </Card>
  );
};

export default GotoGamemode;
