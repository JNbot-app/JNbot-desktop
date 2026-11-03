import YourChains from './YourChains';
import ScriptChain from './ScriptChain';
import { CHAIN_OPTIONS_TAB, type ChainOptionsPanelData } from 'renderer/components/other/botSideBar/panelTabs';
import { usePanelContext } from '../../other/botSideBar/SidePanelContextProvider';
import { useState } from 'react';
import type {
  Chain,
  ChainOptions as ChainRunOptions,
} from '../../../../main/src/types';
import { Col, Row } from 'antd';
import {
  setChain,
  setChainOptions,
  useSettingsStore,
} from '../../../redux/settings';
import { DEFAULT_CHAIN_OPTIONS, toChainOptions } from './chainOptionsScheme';

export type SelectedChain = Chain | null;

const Chains = () => {
  const [selectedChain, setSelectedChain] = useState('');
  const { setPanel } = usePanelContext();
  const chain = useSettingsStore(
    (state) => state.settings.scripts?.chains?.[selectedChain],
  );
  const options = useSettingsStore(
    (state) => state.settings.scripts?.[selectedChain],
  );

  const saveChain = (next: SelectedChain) => {
    if (next) setChain(next);
  };

  const openOptions = (
    id: string,
    creating: boolean,
    initialOptions: ChainRunOptions,
  ) => {
    setPanel({
      active: true,
      tab: CHAIN_OPTIONS_TAB,
      data: {
        id,
        creating,
        options: initialOptions,
        onSave: (next: ChainRunOptions) => {
          setChainOptions(id, next);
          if (creating) {
            setChain({ id, name: next.name, chains: [] });
            setSelectedChain(id);
          }
          setPanel((current) => ({
            ...current,
            active: false,
            data: undefined,
          }));
        },
      } satisfies ChainOptionsPanelData,
    });
  };

  const create = () =>
    openOptions(Date.now().toString(), true, {
      ...DEFAULT_CHAIN_OPTIONS,
      name: '',
      gamemode: '',
    });

  const edit = () => {
    if (chain) openOptions(chain.id, false, options ?? toChainOptions(chain));
  };

  return (
    <Row gutter={[16, 16]}>
      <Col md={8} sm={12} xs={24}>
        <YourChains
          selectedChainId={selectedChain}
          setSelectedChain={setSelectedChain}
          onCreate={create}
        />
      </Col>
      <Col md={16} sm={12} xs={24}>
        <ScriptChain
          selectedChainId={selectedChain}
          setSelectedChain={setSelectedChain}
          onSaveChain={saveChain}
          onEditSettings={edit}
        />
      </Col>
    </Row>
  );
};

export default Chains;
