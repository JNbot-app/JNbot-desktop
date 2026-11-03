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
    // No-op: MongoDB is no longer used
  }

  async createUser() {
    // No-op: user persistence is handled by activity analytics
  }

  async signin() {
    this.user = { _id: this.UID };
  }

  async addActivity(activity: BotJoinActivity) {
    await this.activityTracker.addActivity(activity);
  }
}

export default Db_;
