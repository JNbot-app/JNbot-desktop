import { useState, FC } from 'react';
import { Tabs, Modal, Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';


interface TabProps {
  name: string;
  Tab: FC<{ setTab: (value: number) => void }>;
}

interface MacroDocProps {
  tabs: TabProps[];
  open: boolean;
  onClose: () => void;
}


const TabPanel: FC<{ value: number; index: number }> = ({ children, value, index }) => (
  <div
    role="tabpanel"
    hidden={value !== index}
    id={`vertical-tabpanel-${index}`}
    aria-labelledby={`vertical-tab-${index}`}
  >
    {value === index && <div style={{ padding: 3 }}>{children}</div>}
  </div>
);

const MacroDoc: FC<MacroDocProps> = ({ tabs, open, onClose }) => {
  const [value, setValue] = useState(0);

  const handleChange = (key: string) => {
    document.querySelector('#macroDoc .ant-modal-content')?.scrollTo(0, 0);
    setValue(Number(key));
  };

  return (
    <Modal
      id="macroDoc"
      open={open}
      onCancel={onClose}
      footer={null}
      width="100%"
      styles={{ body: {padding: 0, height: '100vh'}}}
    >
      <Button
        onClick={onClose}
        style={{
          width: '50px',
          height: '50px',
          position: 'fixed',
          right: '0.5rem',
          zIndex: 99,
        }}
        icon={<CloseOutlined style={{ color: 'white' }} />}
      />
      <Tabs
        tabPlacement="start"
        activeKey={value.toString()}
        onChange={handleChange}
        style={{ height: '100%' }}
        tabBarStyle={{
          height: '100%',
          background: '#121212',
        }}
        items={tabs.map((tab, i) => ({
          label: tab.name,
          key: i.toString(),
          children: (
            <TabPanel value={value} index={i} style={{ height: '100%', marginLeft: '8rem' }}>
              <tab.Tab setTab={setValue} />
            </TabPanel>
          ),
        }))}
      />
    </Modal>
  );
};

export default MacroDoc;
