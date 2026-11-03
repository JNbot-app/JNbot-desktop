import DisplayGkits from '../components/dashboard/DisplayGkits';
import AltGrid from '../components/alts/AltGrid';
import RanksList from '../components/alts/RanksList';
import { Col, Row, Space } from 'antd';

const Alts = () => {

  return (
    <Space orientation="vertical" size="large" style={{width:"100%"}}>
      <Row gutter={[16, 24]}>
        <Col md={24}>
          <AltGrid />
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col md={12} xs={24}>
          <RanksList />
        </Col>

        <Col md={12} xs={24}>
          <DisplayGkits large />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>

        <Col md={8} xs={24}>
        </Col>
      </Row>
    </Space>
  );
};

export default Alts;
