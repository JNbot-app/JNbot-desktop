import React, { FC, ReactNode } from 'react';
import { Card, Col, Typography } from 'antd';

const { Text } = Typography;

interface ScriptSectionProps {
  title: string;
  children: ReactNode;
}

const ScriptSection: FC<ScriptSectionProps> = ({ children, title }) => {
  return (
    <Col xs={24} sm={12} md={8}>
      <Card
        style={{
          backgroundColor: '#f0f2f5',
          padding: '16px',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: '1.2em', fontWeight: 600 }}>
          {title}
        </Text>
        {children}
      </Card>
    </Col>
  );
};

export default ScriptSection;
