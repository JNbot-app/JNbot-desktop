import fs from 'fs';
import path from 'path';
import { PROFILE_PUBLICATIONS } from '../../src/common/mobileClientContract';

describe('mobile client contract', () => {
  it('publishes every shell-level script UI event', () => {
    expect(PROFILE_PUBLICATIONS).toEqual(
      expect.arrayContaining([
        'LOGS',
        'snackbar',
        'notification',
        'macro-prompt',
        'DIALOG',
        'popup-buttons',
        'altUpdateRequest',
        'option-error',
      ]),
    );
  });

  it('keeps the generated mobile inventory texture manifest byte-for-byte synchronized', () => {
    const root = path.resolve(__dirname, '../..');
    const desktop = path.join(
      root,
      'src/renderer/components/other/botSideBar/panelTabs/inventory/textures.json',
    );
    const mobile = path.resolve(root, '../jnbot-mobile/src/generated/inventory-textures.json');
    expect(fs.readFileSync(mobile, 'utf8')).toBe(fs.readFileSync(desktop, 'utf8'));
  });
});
