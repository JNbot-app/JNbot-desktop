import { FC } from 'react';
import { MdLocalAtm } from 'react-icons/md';
import { useNavigate } from 'react-router-dom';
import {
  useSettingsStore,
  selectAppSettings,
  selectJNdata,
  selectStats,
} from '../../redux/settings';
import StatCard from './StatCard';

const euro = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

const AccountWorth: FC = () => {
  const navigate = useNavigate();
  const stats = useSettingsStore(selectStats);
  const jndata = useSettingsStore(selectJNdata);
  const server =
    useSettingsStore(selectAppSettings)?.server ||
    jndata?.serverList?.[0] ||
    '';

  const worth: number = (server && stats?.[server]?.accountWorth) || 0;

  return (
    <StatCard
      title="Account worth"
      value={euro.format(worth)}
      empty={!worth}
      action={{ label: 'Add ranks to your alts', onClick: () => navigate('/alts') }}
      icon={<MdLocalAtm />}
      tone="accent"
    />
  );
};

export default AccountWorth;
