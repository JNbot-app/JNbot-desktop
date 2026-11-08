import type { PluginOption, PluginOptionChoice } from '../../../common/pluginOptions';

const toChoices = (values?: readonly string[]) => (values ?? []).map((value) => ({ label: value, value }));

/**
 * The values an option can take in one profile: its gamemodes, alts and tags
 * differ per profile. Undefined for free-form options.
 */
export function pluginOptionChoices(
  option: PluginOption,
  profile: { gamemodes?: readonly string[] } | undefined,
  settings: { altData?: Record<string, unknown>; altTags?: { id: string; name: string }[] },
): PluginOptionChoice[] | undefined {
  switch (option.type) {
    case 'gamemodeSelect':
      return toChoices(option.gamemodes ?? profile?.gamemodes ?? []);
    case 'altSelect':
    case 'altsSelect':
    case 'altRange':
      return toChoices(Object.keys(settings.altData ?? {}));
    case 'tagsSelect':
      return (settings.altTags ?? []).map(({ name, id }) => ({ label: name, value: id }));
    case 'select':
      return option.options;
    case 'multiSelect':
      return toChoices(option.options);
    default:
      return undefined;
  }
}
