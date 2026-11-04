import { MacroDatabase } from './Macros';
import MixpanelActivityTracker, {
  type BotJoinActivity,
} from './MixpanelActivityTracker';

class Db_ implements MacroDatabase {
  user: any;
  UID: string;
  private readonly activityTracker: MixpanelActivityTracker;

  constructor(UID: string) {
    this.UID = UID;
    this.user = { _id: UID };
    this.activityTracker = new MixpanelActivityTracker();
  }

  async connect() {
  }

  async createUser() {
  }

  async signin() {
    this.user = { _id: this.UID };
  }

  async addActivity(activity: BotJoinActivity) {
    await this.activityTracker.addActivity(activity);
  }
}

export default Db_;
