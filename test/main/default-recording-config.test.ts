import { defaultRecordingConfig } from '../../src/main/src/functions/Macros';

describe('defaultRecordingConfig', () => {
  it('returns default replay settings schema when no inputs are provided', () => {
    const config = defaultRecordingConfig();
    expect(config).toHaveLength(1);
    expect(config[0].name).toBe('Replay Settings');

    const options = config[0].options;
    expect(options).toHaveLength(3);

    expect(options[0]).toEqual({
      id: 'account',
      label: 'Target Bot / Client',
      type: 'activeBotSelect',
      multiple: false,
      botFilter: 'all',
      tooltip: expect.any(String),
      clearable: true,
    });

    expect(options[1]).toEqual({
      id: 'spatialMode',
      label: 'Positioning',
      type: 'select',
      defaultValue: 'absolute',
      options: [
        { label: 'Recorded world coordinates', value: 'absolute' },
        { label: 'Relative to replay start', value: 'relative' },
      ],
      tooltip: expect.any(String),
    });

    expect(options[2]).toEqual({
      id: 'playMode',
      label: 'Play mode',
      type: 'select',
      defaultValue: 'exact',
      options: [
        { label: 'Replay exactly', value: 'exact' },
        { label: 'Play with AI', value: 'ai' },
      ],
      tooltip: expect.any(String),
    });
  });

  it('maps custom automation inputs into options schema', () => {
    const inputs: any[] = [
      { id: 'targetPlayer', label: 'Player Name', secret: false, required: true },
      { id: 'apiKey', secret: true, required: false },
    ];

    const config = defaultRecordingConfig(inputs);
    const options = config[0].options;
    expect(options).toHaveLength(5);

    // First custom input
    expect(options[3]).toEqual({
      id: 'targetPlayer',
      label: 'Player Name',
      type: 'input',
      inputType: 'text',
      required: true,
    });

    // Second custom input (secret password, fallback label to id)
    expect(options[4]).toEqual({
      id: 'apiKey',
      label: 'apiKey',
      type: 'input',
      inputType: 'password',
      required: false,
    });
  });

  it('handles empty inputs array gracefully', () => {
    const config = defaultRecordingConfig([]);
    expect(config[0].options).toHaveLength(3);
  });
});
