import { Button, Collapse, Typography } from 'antd';
import { RedoOutlined, ReloadOutlined } from '@ant-design/icons';
import styled from 'styled-components';
import * as Sentry from '@sentry/react';
import { DiscordServerLink } from '../components/other/DiscordServer';


const Container = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  transform: translate(-50%);
  position: absolute;
  left: 50%;
  text-align: center;
`;

const ErrorPage: Sentry.FallbackRender = ({ error, componentStack, resetError }) => {
  const err = error as Error | undefined;
  const details = [
    err?.stack || (err ? `${err.name}: ${err.message}` : String(error)),
    componentStack ? `\nComponent stack:${componentStack}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <Container>
      <div>
        <div>
          <svg fill='currentColor' viewBox='0 0 32 32' width='64px' height='64px'>
          <g className="st0" id="grid_system" /><g id="_icons"><path d="M18.9,9.4l1-2c0.2-0.5,0-1.1-0.4-1.3c-0.5-0.2-1.1,0-1.3,0.4l-0.9,1.7l-1,0.6c-0.2-0.2-0.4-0.4-0.6-0.6   C15.5,8.2,15.2,8,15,7.9V7c0-0.5-0.1-0.9-0.3-1.3c0,0,0,0,0,0l1-1c0.4-0.4,0.4-1,0-1.4s-1-0.4-1.4,0l-1,1c0,0,0,0,0,0   C12.9,4.1,12.5,4,12,4c-0.4,0-0.8,0.1-1.1,0.2l-1.3-1C9.2,2.9,8.5,2.9,8.2,3.4C7.9,3.8,8,4.5,8.4,4.8l1,0.8C9.1,6,9,6.5,9,7v0.9   C8.8,8,8.5,8.2,8.3,8.4C7.8,8.7,7.5,9.2,7.1,9.7L6.8,9.4L5.9,7.6C5.6,7.1,5,6.9,4.6,7.1C4.1,7.4,3.9,8,4.1,8.4l1,2   c0,0.1,0.1,0.2,0.2,0.3l1,1c0,0,0,0,0.1,0c0,0,0,0,0,0c-0.1,0.4-0.1,0.8-0.1,1.2H5c-0.6,0-1,0.4-1,1s0.4,1,1,1h1.2   c0,0.4,0.1,0.8,0.1,1.2c0,0,0,0,0,0c0,0,0,0-0.1,0l-1,1c-0.1,0.1-0.1,0.2-0.2,0.3l-1,2c-0.2,0.5,0,1.1,0.4,1.3C4.7,21,4.8,21,5,21   c0.4,0,0.7-0.2,0.9-0.6l0.9-1.9l0.3-0.3C8.2,19.9,10,21,12,21c1.3,0,2.7-0.5,3.7-1.4c0.7-0.6,1.2-1.2,1.5-2l0.9,1.8   c0.2,0.4,0.5,0.6,0.9,0.6c0.1,0,0.3,0,0.4-0.1c0.5-0.2,0.7-0.8,0.4-1.3l-1-2c0-0.1-0.1-0.2-0.2-0.3l-1-1c0-0.4,0.1-0.9,0.1-1.3H19   c0.6,0,1-0.4,1-1s-0.4-1-1-1h-1.3c0-0.1,0-0.1,0-0.2c-0.1-0.4-0.2-0.8-0.3-1.2l1.2-0.8C18.7,9.8,18.8,9.6,18.9,9.4z M11,7   c0-0.6,0.4-1,1-1c0.3,0,0.5,0.1,0.7,0.3C12.9,6.5,13,6.7,13,7v0.1c-0.1,0-0.1,0-0.2,0C12.6,7,12.4,7,12.2,7c-0.1,0-0.1,0-0.2,0   c0,0-0.1,0-0.1,0c-0.2,0-0.5,0-0.7,0.1C11.1,7.1,11,7.1,11,7L11,7z M15.7,15.9c-0.1,0.9-0.6,1.7-1.3,2.2C13.7,18.7,12.9,19,12,19   c-1.8,0-3.4-1.3-3.7-3.1c-0.1-0.6-0.1-1.2-0.1-1.9s0-1.3,0.1-1.9c0.1-0.9,0.6-1.7,1.3-2.2c0.3-0.2,0.5-0.4,0.8-0.5   c0.8-0.4,1.8-0.4,2.7-0.2c0.2,0.1,0.3,0.1,0.5,0.2c0.3,0.1,0.5,0.3,0.8,0.5c0.7,0.6,1.1,1.4,1.3,2.2c0.1,0.6,0.1,1.2,0.1,1.9   S15.8,15.3,15.7,15.9z" /></g>

          </svg>
          </div>

        <br />
        <Typography.Title level={2} >
          Woops, something went wrong! Don't worry, we're working on it!
        </Typography.Title>
        <Typography.Text style={{ fontSize: '0.9em' }}>
          If this error doesn't go away, please report it on our <DiscordServerLink>Discord server</DiscordServerLink>.
        </Typography.Text>
        <br />
        <br />
        <Button type="primary" onClick={resetError} icon={<RedoOutlined />} style={{ marginRight: '8px' }}>
          Let's try that again
        </Button>
        <Button type="default" onClick={() => location.reload()} icon={<ReloadOutlined />}>
          Reload the app
        </Button>

        {details && (
          <Collapse
            ghost
            style={{ marginTop: 24, textAlign: 'left' }}
            items={[
              {
                key: 'details',
                label: 'Show error details',
                children: (
                  <Typography.Paragraph
                    copyable={{ text: details }}
                    style={{
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'monospace',
                      fontSize: '0.8em',
                      maxHeight: 300,
                      overflow: 'auto',
                      maxWidth: 600,
                    }}
                  >
                    {details}
                  </Typography.Paragraph>
                ),
              },
            ]}
          />
        )}
      </div>
    </Container>
  );
};

export default ErrorPage;
