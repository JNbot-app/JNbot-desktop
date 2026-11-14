import type { IconType } from 'react-icons';
import {
  MdAutoAwesome,
  MdCode,
  MdDns,
  MdIosShare,
  MdDisplaySettings,
  MdNavigation,
  MdNotificationsActive,
  MdSmartToy,
  MdVpnKey,
} from 'react-icons/md';
import { defaultKickBehaviorConfig, Themes } from '../../../common/CommonEnums';
import { isProfileSpecificSetting } from '../../../common/appSettingsSchema';
import KickBehaviour from './KickBehavior';
import ProxySettings from './ProxySettings';
import PublisherIdentity from './PublisherIdentity';
import DesktopBackgroundSetting from './DesktopBackgroundSetting';
import LlmSettings from '../llm/LlmSettings';

/**
 * The app-settings schema, shared by the Settings page (renders every tab) and
 * the Profile Wizard (renders just the profile-specific settings so a creator
 * can pick their defaults).
 *
 * Whether a setting is profile-specific is NOT declared here — it is derived
 * from the single source of truth in `src/common/appSettingsSchema.ts` and
 * stamped onto each setting as `profileSpecific`. That keeps the membership in
 * one place while still exposing the flag on every setting object.
 */

export interface SettingDef {
  name: string;
  key: string;
  type?: string;
  description?: string;
  label?: string;
  default?: any;
  options?: any;
  Render?: React.FC<any>;
  /** Derived from `isProfileSpecificSetting(key)` — see module doc. */
  profileSpecific: boolean;
  [extra: string]: any;
}

export interface SettingTab {
  name: string;
  key: string;
  icon: IconType;
  /** Sidebar group the section is listed under. */
  group: string;
  /** Sub-headings in display order; each setting names one via `section`. */
  sections: string[];
  settings: SettingDef[];
}

/** Sections in sidebar order. Profiles and Storage are added by the modal. */
const TABS: Omit<SettingTab, 'settings'>[] = [
  { key: 'general', name: 'General', icon: MdDisplaySettings, group: 'App', sections: ['Appearance', 'System', 'Updates'] },
  { key: 'notifications', name: 'Notifications', icon: MdNotificationsActive, group: 'App', sections: ['Notifications', 'Sounds'] },
  { key: 'connection', name: 'Connection', icon: MdDns, group: 'Bots', sections: ['Server', 'Joining'] },
  { key: 'bot', name: 'Bot behavior', icon: MdSmartToy, group: 'Bots', sections: ['Verification', 'Performance'] },
  { key: 'pathfinder', name: 'Pathfinder', icon: MdNavigation, group: 'Bots', sections: ['Movement'] },
  { key: 'proxies', name: 'Proxies', icon: MdVpnKey, group: 'Bots', sections: ['Rotation'] },
  { key: 'scripts', name: 'Scripts', icon: MdCode, group: 'Automation', sections: ['Execution', 'Logging', 'Discord'] },
  { key: 'ai', name: 'AI assistant', icon: MdAutoAwesome, group: 'Automation', sections: ['Provider'] },
  { key: 'publishing', name: 'Sharing & publishing', icon: MdIosShare, group: 'Marketplace', sections: ['Identity', 'Updates'] },
];

const langNames = [
  { label: 'Nederlands', value: 'nl' },
  { label: 'English', value: 'en' },
  { label: 'Français', value: 'fr' },
];

const langs = ['nl', 'en', 'fr'];

/**
 * Build the settings schema. A function (not a constant) because a few options
 * read browser/runtime state (`window.__JNdata`, `navigator.language`) that
 * isn't ready at module-eval time.
 */
export function getSettingsSchema(): SettingTab[] {
  const raw: any[] = [
          
          {
            name: 'Theme',
            key: 'theme',
            tab: 'general',
            section: 'Appearance',
            description: 'Theme of the app',
            type: 'select',
            default: Themes.BASALT,
            options: Object.values(Themes).map((val) => ({
              label: val.charAt(0).toUpperCase() + val.slice(1),
              value: val,
            })),
          },
          {
            name: 'Language',
            key: 'locale',
            tab: 'general',
            section: 'Appearance',
            description:
              "Doesn't change the language (yet) but changes the date conventions",
            type: 'select',
            label: 'Language',
            default: langs.includes(navigator.language)
              ? navigator.language
              : 'en',
            options: langNames,
          },
          {
            name: 'Allow pre-release updates',
            key: 'allowPrereleaseUpdates',
            tab: 'general',
            section: 'Updates',
            type: 'switch',
            default: false,
            description:
              'Enable to receive beta updates of JNbot before they are officially released.',
          },
          {
            name: 'Keep PC awake',
            key: 'preventSleep',
            tab: 'general',
            section: 'System',
            type: 'switch',
            default: false,
            description:
              'Prevent your PC from going to sleep while the app is open.',
          },
          {
            name: 'Reduce motion',
            key: 'reduceMotion',
            tab: 'general',
            section: 'Appearance',
            type: 'switch',
            default: false,
            description:
              'Disable animations and transitions across the app to reduce lag and improve performance.',
          },
          {
            name: 'External editor command',
            key: 'pluginEditorCommand',
            tab: 'general',
            section: 'System',
            type: 'input',
            default: '',
            description:
              "Command used to open a plugin in your editor (e.g. 'code'). Leave empty to use your OS default app.",
          },
          ...(!window.web
            ? [{
                name: 'Keep JNbot running when the window is closed',
                key: 'desktopBackgroundMode',
                tab: 'general',
                section: 'System',
                type: 'custom',
                layout: 'inline',
                description: 'Keep bots and scripts running in the background. Use Quit JNbot to stop everything.',
                Render: DesktopBackgroundSetting,
              }]
            : []),
          {
            name: 'Auto-update marketplace items',
            key: 'autoUpdateShares',
            tab: 'publishing',
            section: 'Updates',
            type: 'switch',
            default: true,
            description:
              'Install updates of plugins, bundles and profiles from the marketplace automatically. Items from private links show an Update button instead.',
          },
          {
            name: 'Publisher identity & share links',
            key: 'pluginPublisherIdentity',
            tab: 'publishing',
            section: 'Identity',
            type: 'custom',
            description:
              'Name and device fingerprint used to sign exports and share links, and every link you shared. The private key never leaves this device.',
            Render: PublisherIdentity,
          },
          {
            name: 'AI assistant (optional)',
            key: 'llmProvider',
            tab: 'ai',
            section: 'Provider',
            type: 'custom',
            description:
              'Use your own AI provider to write plugins, triggers and chains from a description, explain errors, and use /ask in Discord. Gemini has a free tier and Ollama runs locally. The key stays on this computer.',
            Render: LlmSettings,
          },
          {
            name: 'Default minecraft version',
            key: 'version',
            tab: 'connection',
            section: 'Server',
            type: 'cascade',
            label: 'Minecraft version',
            default: '1.8.9',
            options: window.__JNdata.fullVersions,
          },
          {
            name: 'Server IP',
            key: 'ip',
            tab: 'connection',
            section: 'Server',
            type: 'input',
            description: "The IP of the server. eg. 'play.jartexnetwork.com'",
            label: 'Server IP',
            default: '',
          },
          {
            name: 'Server port',
            key: 'port',
            tab: 'connection',
            section: 'Server',
            type: 'input',
            description: "The port of the server. eg. '25565'",
            label: 'Server port',
            default: '25565',
          },
          {
            name: 'Rotate server ips',
            key: 'serverIpRotation',
            tab: 'connection',
            section: 'Server',
            type: 'switch',
            default: false,
            description:
              'Scripts use different ips to join the server to avoid getting kicked for joining too fast.',
          },
          {
            name: 'Rejoin on login fail',
            key: 'retryOnLoginFail',
            tab: 'connection',
            section: 'Joining',
            description:
              'If you may encounter login failures. Enable this to rejoin when this happens.',
            type: 'switch',
            default: true,
          },
          {
            name: 'Join server timeout (ms)',
            key: 'joinServerTimeout',
            tab: 'connection',
            section: 'Joining',
            description:
              "When the bot hasn't joined the server within this time, it will stop waiting.",
            type: 'select',
            label: 'Timeout (ms)',
            default: 10000,
            options: [
              0, 2000, 5000, 10000, 15000, 20000, 25000, 30000, 45000, 60000,
              90000,
            ].map((val) => ({ label: val.toString(), value: val })),
          },
          {
            name: 'Auto V4guard verification',
            key: 'auto_v4guard',
            tab: 'bot',
            section: 'Verification',
            type: 'switch',
            default: true,
            description: 'Automatically open a browser when V4guard flags you',
          },
          {
            name: 'Map captcha prompt',
            key: 'captcha_prompt',
            tab: 'bot',
            section: 'Verification',
            type: 'switch',
            default: false,
            description:
              'When a bot holds a map right after joining, show it to you so you can type the captcha code.',
          },
          {
            name: 'Auto resource pack accept',
            key: 'autoResourcePackAccept',
            tab: 'bot',
            section: 'Verification',
            type: 'switch',
            default: true,
            description:
              'Automatically accept resource packs when the server offers them.',
          },
          {
            name: 'Kick behavior',
            key: 'kickBehaviour',
            tab: 'connection',
            section: 'Joining',
            type: 'custom',
            description:
              'How should the bot handle being kicked from the server?',
            default: defaultKickBehaviorConfig,
            Render: KickBehaviour,
          },
          {
            name: 'Render distance',
            key: 'render_distance',
            tab: 'bot',
            section: 'Performance',
            description:
              'Chunk render distance requested from the server. Lower values significantly reduce memory.',
            type: 'select',
            label: 'Render distance',
            default: 12,
            options: [2, 4, 6, 8, 10, 12, 16].map((val) => ({
              label: `${val} chunks`,
              value: val,
            })),
          },
          {
            name: 'Reduced events',
            key: 'reduced_events',
            tab: 'bot',
            section: 'Performance',
            type: 'switch',
            default: false,
            description:
              'Disables high-frequency cosmetic events (lighting updates, particles, sounds, explosions) to save compute.',
          },
      
          {
            name: 'Bot join delay (ms)',
            key: 'join_delay',
            tab: 'connection',
            section: 'Joining',
            description:
              "The minimum time between 2 bots connecting to join the server. ",
            type: 'number',
            label: 'Join delay (ms)',
            default: 3000,
          },
          {
            name: "Bot delay premium accounts (ms)",
            key: 'join_delay_premium',
            tab: 'connection',
            section: 'Joining',
            description:
              "The minimum time between 2 premium bots connecting to join the server. ",
            type: 'number',
            label: 'Join delay premium (ms)',
            default: 3000,
          },
          {
            name: "Auto ping servers",
            key: 'auto_ping_servers',
            tab: 'connection',
            section: 'Server',
            description: "Automatically ping servers to detect if a ip is reachable.",
            type: 'switch',
            default: true,
          },
          {
            name: 'Optimistic join gamemode',
            key: 'optimistic_join_gamemode',
            tab: 'scripts',
            section: 'Execution',
            description:
              'Join a gamemode without verifying whether the bot has joined the gamemode successfully.',
            type: 'switch',
            label: '',
            default: false,
          },
          {
            name: 'Script console logging',
            key: 'script_console_logging',
            tab: 'scripts',
            section: 'Logging',
            type: 'switch',
            default: false,
            description: 'Write the logs into a file',
          },
          {
            name: 'Logging directory',
            key: 'logging_dir',
            tab: 'scripts',
            section: 'Logging',
            type: 'input_file',
            options: {
              directory: true,
              multiple: 'false',
              webkitdirectory: true,
            },
            description: 'Path to the directory the files will appear in.',
            label: 'Directory path',
            default: '',
          },
          {
            name: 'Discord webhook for logs',
            key: 'logs_webhook',
            tab: 'scripts',
            section: 'Logging',
            type: 'input',
            description:
              'Send the script logs to a discord channel through a webhook.',
            label: 'https://discord.com/api/webhooks/...',
          },
          {
            name: 'Discord on startup',
            key: 'discord_on_startup',
            tab: 'scripts',
            section: 'Discord',
            type: 'switch',
            default: false,
            description:
              'Automatically starting discord bot (if configured) when opening the app',
          },
          {
            name: 'Delay between actions',
            key: 'delay_between_actions',
            tab: 'scripts',
            section: 'Execution',
            description:
              'Delay between 2 actions (eg. open window | click window) in ms. Used in scripts such as gkit collector, ...',
            type: 'select',
            label: 'Delay (ms)',
            default: 250,
            options: [
              0, 50, 100, 250, 400, 500, 750, 1000, 1500, 2000, 3000, 4000,
              5000,
            ].map((val) => ({ label: val.toString(), value: val })),
          },
          {
            name: 'Optimize script memory',
            key: 'worker_optimize_for_size',
            tab: 'scripts',
            section: 'Execution',
            type: 'switch',
            default: false,
            description:
              'Reduces memory usage for scripts. This memory reduction comes at the cost of compute performance.',
          },
          {
            name: 'Allow sprinting',
            key: 'pathfinder_allowSprinting',
            tab: 'pathfinder',
            section: 'Movement',
            type: 'switch',
            default: true,
            description: 'Allow the bot to sprint while calculating paths.',
          },
          {
            name: 'Allow parkour',
            key: 'pathfinder_allowParkour',
            tab: 'pathfinder',
            section: 'Movement',
            type: 'switch',
            default: true,
            description: 'Allow the bot to jump across gaps.',
          },
          {
            name: 'Allow digging',
            key: 'pathfinder_canDig',
            tab: 'pathfinder',
            section: 'Movement',
            type: 'switch',
            default: true,
            description: 'Allow the bot to break blocks to clear paths.',
          },
          {
            name: 'Allow opening doors',
            key: 'pathfinder_canOpenDoors',
            tab: 'pathfinder',
            section: 'Movement',
            type: 'switch',
            default: true,
            description: 'Allow the bot to open wooden doors and gates.',
          },
          {
            name: 'Allow 1x1 towers',
            key: 'pathfinder_allow1by1towers',
            tab: 'pathfinder',
            section: 'Movement',
            type: 'switch',
            default: true,
            description: 'Allow placing blocks beneath feet to pillar upward.',
          },
          {
            name: 'Allow diagonal movement',
            key: 'pathfinder_allowDiagonal',
            tab: 'pathfinder',
            section: 'Movement',
            type: 'switch',
            default: true,
            description: 'Allow pathing diagonally between adjacent blocks.',
          },
          {
            name: 'Free motion (flying/swimming)',
            key: 'pathfinder_allowFreeMotion',
            tab: 'pathfinder',
            section: 'Movement',
            type: 'switch',
            default: false,
            description: 'Pathfinding for creative flight or swimming freely.',
          },
          {
            name: 'Entity avoidance detection',
            key: 'pathfinder_allowEntityDetection',
            tab: 'pathfinder',
            section: 'Movement',
            type: 'switch',
            default: true,
            description: 'Avoid pathing directly through entities and mobs.',
          },
          {
            name: 'Max drop down (blocks)',
            key: 'pathfinder_maxDropDown',
            tab: 'pathfinder',
            section: 'Movement',
            type: 'select',
            label: 'Blocks',
            default: 4,
            options: [1, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20].map((val) => ({
              label: `${val} blocks`,
              value: val,
            })),
            description: 'Maximum height the bot is permitted to drop down without taking damage.',
          },
          {
            name: 'Liquid cost multiplier',
            key: 'pathfinder_liquidCost',
            tab: 'pathfinder',
            section: 'Movement',
            type: 'select',
            label: 'Cost multiplier',
            default: 3,
            options: [1, 2, 3, 4, 5, 10, 20].map((val) => ({
              label: `${val}x`,
              value: val,
            })),
            description: 'Path penalty cost when wading through water/lava.',
          },
          {
            name: 'Dont create block flow',
            key: 'pathfinder_dontCreateFlow',
            tab: 'pathfinder',
            section: 'Movement',
            type: 'switch',
            default: true,
            description: 'Prevent breaking blocks that could unleash fluid flows.',
          },
          {
            name: 'Rotating proxy pool',
            key: 'proxy',
            tab: 'proxies',
            section: 'Rotation',
            type: 'custom',
            description: 'Route each bot connection through the next SOCKS proxy in this profile’s pool.',
            default: { enabled: false, urls: [] },
            Render: ProxySettings,
          },
          {
            name: 'System notifications',
            key: 'notification_on',
            tab: 'notifications',
            section: 'Notifications',
            type: 'switch',
            default: true,
            description:
              'Show JNbot notifications on your desktop while the app is in the background.',
          },
          {
            name: 'Sound on script ended',
            key: 'script_finished_sound',
            tab: 'notifications',
            section: 'Sounds',
            type: 'switch',
            default: false,
            description: 'Play a sound when a script finishes.',
          },
          {
            name: 'Sound on gkit ready',
            key: 'gkit_ready',
            tab: 'notifications',
            section: 'Sounds',
            type: 'switch',
            default: true,
            description: 'Play a sound when a gkit is ready to collect.',
          },
  ];

  // Stamp the profile-specific flag onto every setting from the single source
  // of truth so the rest of the UI never has to ask twice, then group by tab.
  return TABS.map((tab) => ({
    ...tab,
    settings: raw
      .filter((s) => s.tab === tab.key)
      .map((s) => ({ ...s, profileSpecific: isProfileSpecificSetting(s.key) }))
      .sort((x, y) => tab.sections.indexOf(x.section) - tab.sections.indexOf(y.section)),
  })).filter((tab) => tab.settings.length > 0) as SettingTab[];
}

/**
 * Flat list of every profile-specific setting descriptor, in schema order.
 * Used by the Profile Wizard's "Default settings" step.
 */
export function getProfileSettingDescriptors(): SettingDef[] {
  return getSettingsSchema()
    .flatMap((tab) => tab.settings)
    .filter((s) => s.profileSpecific);
}
