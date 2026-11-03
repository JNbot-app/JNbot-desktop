import ErrorHandler_ from '../../src/main/src/functions/ErrorHandler';
import { setPlatform } from '../../src/main/src/platform';

describe('ErrorHandler platform reporting', () => {
  const originalEnv = process.env;
  const originalIsMobileRuntime = (global as any).isMobileRuntime;
  const originalIsCLI = (global as any).isCLI;

  beforeEach(() => {
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

  const report = (uid: string, script: string) => {
    const reporter = jest.fn();
    const handler = new ErrorHandler_(uid);
    handler.setReporter(reporter);
    handler.handle({ message: `${script} failed`, stack: `Error: ${script} failed`, script });
    expect(reporter).toHaveBeenCalledTimes(1);
    const [error, context] = reporter.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(`${script} failed`);
    expect(context.user).toBe(uid);
    expect(context.tags.script).toBe(script);
    return context.tags.platform;
  };

  it('reports the Desktop platform by default', () => {
    expect(report('test-uid-desktop', 'mining_macro')).toBe('Desktop');
  });

  it('reports the Mobile platform when the mobile runtime is active', () => {
    process.env.JNBOT_MOBILE_RUNTIME = 'true';
    (global as any).isMobileRuntime = true;
    expect(report('test-uid-mobile', 'auto_farm')).toBe('Mobile');
  });

  it('reports the CLI platform when CLI mode is active', () => {
    process.env.CLI_MODE = 'true';
    (global as any).isCLI = true;
    expect(report('test-uid-cli', 'cli_runner')).toBe('CLI');
  });
});
