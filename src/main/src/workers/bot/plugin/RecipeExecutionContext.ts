import type { Bot } from '../../workerTypes';

export default class RecipeExecutionContext {
  public readonly outputs = new Map<string, any>();
  public readonly loops = new Map<string, any>();

  constructor(
    private readonly onBot: (bot: Bot) => void,
    public bot: Bot | null = null,
    public readonly trigger: Record<string, any> = {},
  ) {}

  public fork() {
    const child = new RecipeExecutionContext(
      this.onBot,
      this.bot,
      this.trigger,
    );
    this.outputs.forEach((value, key) => child.outputs.set(key, value));
    this.loops.forEach((value, key) => child.loops.set(key, value));
    return child;
  }

  public getBot(): Bot {
    if (!this.bot) {
      throw new Error(
        'This action needs a connected bot. Add Join server first.',
      );
    }
    return this.bot;
  }

  public setBot(bot: Bot) {
    this.bot = bot;
    this.onBot(bot);
  }

  public restoreBot(bot: Bot | null) {
    this.bot = bot;
  }
}
