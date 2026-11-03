


export enum LogStatus {
    INFO,
    WARN,
    ERROR,
    SUCCESS
}

export enum UpdateState {
  NO_UPDATE = 0,
  DOWNLOADING = 1,
  READY_TO_INSTALL = 2,
  ERROR = 3,
  INSTALLING = 4,
}

export enum KickBehaviorOptions {
  RETRY,
  PAUSE ,
  SKIP,
}

/**
 * Runner control buttons a script can expose in the UI. Combined as a bitfield
 * (e.g. `ScriptControl.PAUSE | ScriptControl.SKIP`). The script declares which
 * buttons are enabled via `script.setControls(...)` and receives a click event
 * with the single pressed bit via `script.onControl(...)`.
 */
export enum ScriptControl {
  NONE = 0,
  PAUSE = 1 << 0,
  RESUME = 1 << 1,
  RESTART = 1 << 2,
  SKIP = 1 << 3,
  PREVIOUS = 1 << 4,
}


export enum Themes {
  LIGHT = "light",
  DARK = "dark",
  OBSIDIAN = "obsidian",
  NIGHT = "night",
  GOLD = "gold",
  SCULK = "sculk",
  BASALT = "basalt",
}





export const defaultKickBehaviorConfig = {
    rules: [
      // {
      //   id: '0',
      //   kickMessage: 'https://v4g.to',
      //   action: KickBehaviorOptions.PAUSE,
      // },
      // {
      //   id: '1',
      //   kickMessage: "we're receiving too many connections, please try to connect again in a few",
      //   action: KickBehaviorOptions.PAUSE,
      // },
      // {
      //   id: '2',
      //   kickMessage: 'wrong password',
      //   action: KickBehaviorOptions.SKIP,
      // },
      // {
      //   id: '3',
      //   kickMessage: 'You are already connected to this proxy',
      //   action: KickBehaviorOptions.PAUSE,
      // },
      // {
      //   id: '4',
      //   kickMessage: 'You are already logged on to this server',
      //   action: KickBehaviorOptions.PAUSE,
      // }
    ],
    defaultAction: KickBehaviorOptions.RETRY,
  }

export enum MinecraftLauncherTypes {
    VANILLA = 0,
    JNBOT_CLIENT = 1,
    FABRIC = 2,
    OPTIFINE = 3,
    FORGE = 4,
    QUILT = 5,
    LABYMOD = 6,
    LUNAR = 7,
}
