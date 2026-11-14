import { fireEvent, render, screen } from '@testing-library/react';
import { Form } from 'antd';
import ScriptSelectOption from './ScriptSelectOption';

jest.mock('../../../../hooks/useRunnableScripts', () => ({
  useRunnableScripts: () => ({
    loading: false,
    scripts: [
      { info: { pluginId: 'a1', name: 'Farm', scriptType: 'action' } },
      { info: { pluginId: 'chain:c1', name: 'Daily', scriptType: 'script' } },
    ],
  }),
}));

const setup = (option: object, target?: string | string[]) => {
  const onChange = jest.fn();
  render(
    <Form initialValues={{ target }}>
      <ScriptSelectOption
        option={{ id: 'target', label: 'Target', type: 'scriptSelect', ...option }}
        onChange={onChange}
      />
    </Form>,
  );
  return onChange;
};

const open = () => fireEvent.mouseDown(screen.getByRole('combobox'));

describe('ScriptSelectOption', () => {
  beforeAll(() => {
    window.matchMedia = jest.fn().mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
    });
    window.ResizeObserver = jest.fn().mockReturnValue({
      observe: jest.fn(),
      unobserve: jest.fn(),
      disconnect: jest.fn(),
    });
  });

  it('groups scripts by kind and stores the plain id', () => {
    const onChange = setup({});
    open();
    expect(screen.getByText('Actions')).toBeTruthy();
    expect(screen.getByText('Chains')).toBeTruthy();
    fireEvent.click(screen.getByText('Daily'));
    expect(onChange).toHaveBeenCalledWith('chain:c1', expect.anything());
  });

  it('only offers the configured kinds', () => {
    setup({ kinds: ['chain'] });
    open();
    expect(screen.queryByText('Farm')).toBeNull();
    expect(screen.getByText('Daily')).toBeTruthy();
  });

  it('stores an id array when multiple', () => {
    const onChange = setup({ multiple: true }, ['a1']);
    open();
    fireEvent.click(screen.getByText('Daily'));
    expect(onChange).toHaveBeenCalledWith(['a1', 'chain:c1'], expect.anything());
  });

  it('labels a saved id that no longer exists', () => {
    setup({}, 'deleted');
    expect(screen.getByText('Unavailable script')).toBeTruthy();
  });
});
