import { FC, ReactNode } from 'react';
import { Card as AntCard, Typography,CardProps } from 'antd';

const Card: FC<{
  title?: string | ReactNode;
  children?: ReactNode | null;
  icon?: JSX.Element;
  end?: JSX.Element | JSX.Element[] | null;
  style?: React.CSSProperties;
} & CardProps> = ({ children, title, icon, end, ...cardProps }) => {
  return (
    <AntCard
      title={
        <div style={{display:"flex",gap:"1rem",alignItems:"center"}}>
          {icon}
          <Typography.Title style={{margin:0}} level={5} className="text-truncate">
            {title}
          </Typography.Title>
        </div>
      }
      styles={{
        header: {display:"flex",alignItems:"center"}
      }}
      extra={end && <div style={{transform:"translateY(8px)"}}>{end}</div>}
      {...cardProps}
    >
      {children}
    </AntCard>
  );
};

export default Card;
