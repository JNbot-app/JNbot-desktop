import useSettingsStore, { selectSettings } from '../../redux/settings';
import { useEffect, useState } from 'react';
import { Spin } from 'antd';
let hasLoaded = false;
const Loader = () => {
  const [loading, setLoading] = useState(true);
  const settings = useSettingsStore(selectSettings);
  hasLoaded = !loading;
  useEffect(() => {
    if (settings.scripts && !hasLoaded) {
      setLoading(false);
    }
  }, [settings]);
  if (!loading) return null;
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div>
        <Spin size="large" />
        <br /> <br />
        <span>Loading...</span>
      </div>
    </div>
  );
};
export default Loader;
