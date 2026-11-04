import { fireEvent, render, screen } from '@testing-library/react';
import { defaultPluginAction, type SharePluginPreview } from '../../../common/share';
import SharePluginRow from './SharePluginRow';

const plugin = (state: SharePluginPreview['state']): SharePluginPreview => ({
  ownerId: 'owner',
  pluginId: 'autofarm',
  revision: 'r',
  name: 'Autofarm',
  state,
  verification: 'valid-untrusted',
  code: '',
});

describe('SharePluginRow', () => {
  test('a plugin update stays opt-in', () => {
    const onChoice = jest.fn();
    const row = plugin('update');
    render(<SharePluginRow plugin={row} choice={defaultPluginAction(row)} onChoice={onChoice} />);
    expect(screen.getByText('This share has an update for this plugin:')).toBeInTheDocument();
    expect(defaultPluginAction(row)).toBe('skip');
    fireEvent.click(screen.getByText('Update'));
    expect(onChoice).toHaveBeenCalledWith('replace');
  });

  test('a conflict offers replace or skip, not a second copy', () => {
    const row = plugin('conflict');
    render(<SharePluginRow plugin={row} choice={defaultPluginAction(row)} onChoice={jest.fn()} />);
    expect(screen.getByText('Replace')).toBeInTheDocument();
    expect(screen.getByText('Skip')).toBeInTheDocument();
    expect(screen.queryByText('Keep both')).not.toBeInTheDocument();
  });

  test('new plugins have no choice to make', () => {
    render(<SharePluginRow plugin={plugin('new')} choice="replace" onChoice={jest.fn()} />);
    expect(screen.queryByText('Skip')).not.toBeInTheDocument();
  });
});
