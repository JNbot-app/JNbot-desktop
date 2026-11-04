import { FC, PropsWithChildren } from 'react';
import { Divider, theme, Typography } from 'antd';

const SectionHeading: FC<PropsWithChildren> = ({ children }) => {
  const { token } = theme.useToken();
  return (
    <>
      <Typography.Title
        level={3}
        style={{ marginTop: token.marginXL, marginBottom: token.marginSM }}
      >
        {children}
      </Typography.Title>
      <Divider style={{ marginBlock: `0 ${token.marginLG}px` }} />
    </>
  );
};

export default SectionHeading;
