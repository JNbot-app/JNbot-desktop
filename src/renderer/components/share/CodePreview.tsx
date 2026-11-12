import { useState } from 'react';
import { Button, theme } from 'antd';

/** A "View code" link that folds out the code, so it can be read before installing. */
const CodePreview: React.FC<{ code: string; label?: string }> = ({
  code,
  label = 'code',
}) => {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button
        size="small"
        type="link"
        style={{ padding: 0 }}
        onClick={() => setOpen(!open)}
      >
        {open ? `Hide ${label}` : `View ${label}`}
      </Button>
      {open && (
        <pre
          style={{
            margin: `${token.marginXS}px 0 0`,
            maxHeight: 320,
            overflow: 'auto',
            padding: token.paddingSM,
            background: token.colorFillTertiary,
            borderRadius: token.borderRadius,
            fontSize: token.fontSizeSM,
            fontFamily: token.fontFamilyCode,
          }}
        >
          {code}
        </pre>
      )}
    </div>
  );
};

export default CodePreview;
