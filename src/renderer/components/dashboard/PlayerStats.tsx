import React, { useContext } from 'react';
import { Input } from 'antd';
import { MdPersonSearch } from 'react-icons/md';
import { AppContext } from '../../redux/appContext';
import { SearchOutlined } from '@ant-design/icons';
import Card from '../Card';
const { Search: AntSearch } = Input;

const PlayerStats: React.FC = () => {
  const { openAccountProfile } = useContext(AppContext);

  const keyHandler = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && e.currentTarget.value) {
      openAccountProfile(e.currentTarget.value);
    }
  };

  const openAlt = () => {
    const username = (
      document.getElementById('player-stat-username') as HTMLInputElement
    )?.value;
    if (username) {
      openAccountProfile(username);
    }
  };

  return (
    <Card icon={<MdPersonSearch />} title={'Player stats'}>
      <AntSearch
        size="large"
        placeholder="username"
        id="player-stat-username"
        onSearch={openAlt}
        onKeyDown={keyHandler}
        enterButton={<SearchOutlined />}
      />
    </Card>
  );
};

export default PlayerStats;
