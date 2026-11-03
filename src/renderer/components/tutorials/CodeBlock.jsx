import { CopyBlock, dracula } from 'react-code-blocks';

function CodeBlock({ code }) {
  return (
    <CopyBlock
      text={code}
      language="javascript"
      theme={dracula}
      wrapLines
      codeBlock
      className="code-block"
    />
  );
}

export default CodeBlock;
