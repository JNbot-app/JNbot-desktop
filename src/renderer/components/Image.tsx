import { FC, useState } from 'react';
import { LoadingOutlined } from '@ant-design/icons';
import { Space, Spin } from 'antd';

const Image: FC<{
  src: string;
  alt?: string;
  width?: number;
  heigth?: number;
  height?: number;
  center?: boolean;
  loadingElement?: JSX.Element;
  style?: React.CSSProperties;
}> = ({
  src,
  alt,
  width,
  heigth,
  height,
  center,
  loadingElement,
  style = {},
}) => {
  const [loading, setLoading] = useState(true);
  const LoadingEl = loadingElement ??     <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
  if (width) style.width = width + 'px';
  if (heigth || height) style.height = (heigth ?? height) + 'px';

  return (
    <div style={{ width: width + 'px', height: (heigth ?? height) + 'px' }}>
      <div
        style={{
          textAlign: center ? 'center' : undefined,
        }}
      >
        {loading ? LoadingEl : null}
      </div>
      <img
        src={src}
        style={{ display: loading ? 'none' : '', ...style }}
        alt={alt}
        onLoad={() => setLoading(false)}
      />
    </div>
  );
};

export default Image;
