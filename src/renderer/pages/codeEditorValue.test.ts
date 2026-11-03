import { codeEditorValue } from './codeEditorValue';

describe('codeEditorValue', () => {
  test('unwraps JavaScript plugin code for the editor', () => {
    expect(codeEditorValue({ code: 'module.exports = true;' })).toBe(
      'module.exports = true;',
    );
  });

  test('accepts legacy source strings and rejects invalid code', () => {
    expect(codeEditorValue('module.exports = true;')).toBe(
      'module.exports = true;',
    );
    expect(codeEditorValue({ code: { code: 'nested' } })).toBeNull();
  });
});
