import { forwardRef } from 'react';

import { Button } from 'antd';
import { ButtonSnackbarProps } from '../../../main/src/types';

const ButtonSnackbar = forwardRef<HTMLDivElement, ButtonSnackbarProps>(
  (props, ref) => {
    const handleDismiss = (response: string) => {
      if (!props.isMain) {
        if (!props.messageAddress) return;
        window.messenger.send(
          'popup-buttons-' + props.popupID,
          props.messageAddress,
          { response },
        );
      } else {
        window.ipcRenderer.send('popup-buttons', {
          targetId: props.popupID,
          response,
        });
      }
      props.onClose();
    };

    const btns = props.btns ?? [];
    return (
      <div ref={ref} style={{ display: 'flex', gap: '0.5rem' }}>
        {btns.map(({ label, id, variant }) => (
          <Button
            key={id}
            size={btns.length > 4 ? 'small' : 'middle'}
            onClick={() => handleDismiss(id)}
            variant={variant}
          >
            {label}
          </Button>
        ))}
      </div>
    );
  },
);

export default ButtonSnackbar;
