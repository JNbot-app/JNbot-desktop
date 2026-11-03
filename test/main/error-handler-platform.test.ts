import axios from 'axios';
import ErrorHandler_ from '../../src/main/src/functions/ErrorHandler';
import { setPlatform } from '../../src/main/src/platform';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn().mockResolvedValue({ status: 200 }),
  },
}));

describe('ErrorHandler platform reporting in Discord webhook', () => {
  const originalEnv = process.env;
  const originalIsMobileRuntime = (global as any).isMobileRuntime;
  const originalIsCLI = (global as any).isCLI;

  beforeEach(() => {
    jest.clearAllMocks();
    setPlatform(null);
    process.env = { ...originalEnv, NODE_ENV: 'production' };
    delete process.env.DEBUG_PROD;
    delete process.env.JNBOT_MOBILE_RUNTIME;
    delete process.env.JNBOT_CLI_MODE;
    delete process.env.CLI_MODE;
    delete (global as any).isMobileRuntime;
    delete (global as any).isCLI;
  });

  afterAll(() => {
    process.env = originalEnv;
    (global as any).isMobileRuntime = originalIsMobileRuntime;
    (global as any).isCLI = originalIsCLI;
    setPlatform(null);
  });

  it('includes Desktop platform in Discord webhook payload by default', () => {
    const handler = new ErrorHandler_('test-uid-desktop');
    handler.handle({
      message: 'Test desktop crash',
      stack: 'Error: Test desktop crash\n  at test',
      script: 'mining_macro',
    });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [, body] = (axios.post as jest.Mock).mock.calls[0];
    const embed = body.embeds[0];

    const platformField = embed.fields.find((f: any) => f.name === 'Platform');
    expect(platformField).toEqual({ name: 'Platform', value: 'Desktop' });
    expect(embed.footer.text).toBe('JNbot error support • Desktop');
  });

  it('includes Mobile platform in Discord webhook payload when mobile runtime is active', () => {
    process.env.JNBOT_MOBILE_RUNTIME = 'true';
    (global as any).isMobileRuntime = true;

    const handler = new ErrorHandler_('test-uid-mobile');
    handler.handle({
      message: 'Test mobile error',
      stack: 'Error: Test mobile error',
      script: 'auto_farm',
    });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [, body] = (axios.post as jest.Mock).mock.calls[0];
    const embed = body.embeds[0];

    const platformField = embed.fields.find((f: any) => f.name === 'Platform');
    expect(platformField).toEqual({ name: 'Platform', value: 'Mobile' });
    expect(embed.footer.text).toBe('JNbot error support • Mobile');
  });

  it('includes CLI platform in Discord webhook payload when CLI mode is active', () => {
    process.env.CLI_MODE = 'true';
    (global as any).isCLI = true;

    const handler = new ErrorHandler_('test-uid-cli');
    handler.handle({
      message: 'Test cli failure',
      stack: 'Error: Test cli failure',
      script: 'cli_runner',
    });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [, body] = (axios.post as jest.Mock).mock.calls[0];
    const embed = body.embeds[0];

    const platformField = embed.fields.find((f: any) => f.name === 'Platform');
    expect(platformField).toEqual({ name: 'Platform', value: 'CLI' });
    expect(embed.footer.text).toBe('JNbot error support • CLI');
  });
});
