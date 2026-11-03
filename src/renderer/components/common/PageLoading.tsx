import { useEffect, useState } from 'react';
import { Skeleton, theme } from 'antd';

type PageLoadingProps = {
  layout?: 'rows' | 'panels' | 'editor';
};

export default function PageLoading({ layout = 'panels' }: PageLoadingProps) {
  const { token } = theme.useToken();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 180);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      role={visible ? 'status' : undefined}
      aria-label={visible ? 'Loading page' : undefined}
      style={{ padding: token.paddingLG, minHeight: 240 }}
    >
      {visible && (
        <div aria-hidden="true">
          <Skeleton title={{ width: 180 }} paragraph={false} />
          <div
            style={{
              display: layout === 'panels' ? 'grid' : 'flex',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
              flexDirection: 'column',
              gap: token.marginMD,
              marginTop: token.marginLG,
            }}
          >
            {Array.from({ length: layout === 'editor' ? 1 : 3 }, (_, index) => (
              <div
                key={index}
                style={{
                  height: layout === 'editor' ? 320 : layout === 'rows' ? 56 : 160,
                  borderRadius: token.borderRadiusLG,
                  background: token.colorFillTertiary,
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
