import ReactMarkdown from 'react-markdown';
import { Typography, theme } from 'antd';

/** An AI reply, rendered as markdown in a subtle box. */
const LlmAnswer = ({ text }: { text: string }) => {
  const { token } = theme.useToken();
  return (
    <Typography
      style={{
        background: token.colorFillAlter,
        borderRadius: token.borderRadius,
        padding: `${token.paddingXS}px ${token.paddingSM}px`,
        maxHeight: 360,
        overflow: 'auto',
      }}
    >
      <ReactMarkdown>{text}</ReactMarkdown>
    </Typography>
  );
};

export default LlmAnswer;
