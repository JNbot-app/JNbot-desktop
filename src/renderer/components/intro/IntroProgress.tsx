/* eslint-disable react/jsx-filename-extension, import/extensions */
import { theme } from 'antd';

interface IntroProgressProps {
  step: number;
  total: number;
}

const IntroProgress = ({ step, total }: IntroProgressProps) => {
  const { token } = theme.useToken();

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        gap: token.marginXXS,
        alignItems: 'center',
      }}
    >
      {Array.from({ length: total }, (_, item) => {
        const isActive = item === step;

        return (
          <span
            key={item}
            style={{
              width: isActive ? 24 : 14,
              height: 4,
              borderRadius: token.borderRadius,
              backgroundColor: isActive
                ? token.colorPrimary
                : token.colorFillTertiary,
              transition: 'all 220ms ease',
            }}
          />
        );
      })}
    </div>
  );
};

export default IntroProgress;
