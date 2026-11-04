import { Layout } from "antd"

const Footer = () => {
  return (
    <Layout.Footer style={{textAlign:"end",transform:"translateY(20px)", background:"transparent", zIndex: 0, position:"relative"}}>
        {/* <Typography.Text type="secondary" style={{fontSize:"10px"}}>
          © {new Date().getFullYear()} made by usserwout. All rights reserved.
        </Typography.Text> */}
    </Layout.Footer>
  )
}
export default Footer
