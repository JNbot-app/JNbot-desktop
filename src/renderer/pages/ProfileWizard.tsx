import { Button, Card, Flex, theme } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  useSettingsStore,
  selectCustomProfiles,
  selectJNdata,
  switchServer,
  upsertCustomProfile,
} from '../redux/settings';
import { createCustomProfile, DEFAULT_GAMEMODE } from '../../common/createCustomProfile';
import type { CreateProfileInput } from '../../common/mobileClientContract';
import {
  CustomProfile,
  gamemodeKey,
  generateProfileId,
  makeEmptyProfile,
  normalizeProfileGamemodes,
  profileFromJNdata,
} from '../../common/profiles';
import WizardSidebar from '../components/profiles/WizardSidebar';
import StepServer, { ServerErrors } from '../components/profiles/steps/StepServer';
import StepGamemodes, { GamemodesValues } from '../components/profiles/steps/StepGamemodes';
import StepRanksGkits from '../components/profiles/steps/StepRanksGkits';
import StepScripts from '../components/profiles/steps/StepScripts';
import StepProfileUi from '../components/profiles/steps/StepProfileUi';
import StepBotExtension from '../components/profiles/steps/StepBotExtension';
import StepDefaultSettings from '../components/profiles/steps/StepDefaultSettings';
import type { SectionKey } from '../components/profiles/wizardUtils';
import type { ProfileScript } from '../../common/profileScripts';
import useAppApi from '../hooks/useAppApi';

const serverErrors = (profile: CustomProfile): ServerErrors => ({
  name: profile.data.name?.trim() ? undefined : 'Give the server a name',
  address: profile.data.defaultIp ? undefined : 'Enter the server address',
});

const ProfileWizard = () => {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();
  const [search] = useSearchParams();
  // Set by the intro's "Advanced settings": prefill from its form and return there.
  const onboardingDraft = (
    useLocation().state as { onboardingDraft?: CreateProfileInput } | null
  )?.onboardingDraft;
  const { message, modal } = useAppApi();

  const mode: 'new' | 'edit' | 'clone' =
    routeId && search.get('action') === 'clone'
      ? 'clone'
      : routeId
        ? 'edit'
        : 'new';

  const jndata = useSettingsStore(selectJNdata);
  const customProfiles = useSettingsStore(selectCustomProfiles);
  const linkedEdit =
    mode === 'edit'
      ? customProfiles.find(
          (candidate) =>
            candidate.id === routeId && !!candidate.sourceProfileId,
        )
      : undefined;

  useEffect(() => {
    if (!linkedEdit) return;
    message.warning(
      'Synced profiles are read-only. Create an editable copy to make changes.',
    );
    navigate('/profiles', { replace: true });
  }, [linkedEdit, message, navigate]);

  const [profile, setProfile] = useState<CustomProfile>(() => {
    // serverList already holds the custom ids once merged.
    const reservedIds = [...(jndata?.serverList ?? []), ...customProfiles.map((p) => p.id)];
    if (mode === 'edit' && routeId) {
      const existing = customProfiles.find((p) => p.id === routeId);
      if (existing) return structuredClone(existing);
    }
    if (mode === 'clone' && routeId) {
      const sourceId = search.get('source') ?? routeId;
      return profileFromJNdata(jndata, sourceId, generateProfileId(reservedIds));
    }
    if (onboardingDraft) {
      try {
        return createCustomProfile(onboardingDraft, reservedIds, []);
      } catch {
        // Incomplete draft: start empty, saving validates the essentials.
      }
    }
    return makeEmptyProfile(generateProfileId(reservedIds));
  });
  const initialJson = useRef(JSON.stringify(profile));
  const [section, setSection] = useState<SectionKey>('server');
  const [showErrors, setShowErrors] = useState(false);
  const errors = showErrors ? serverErrors(profile) : {};

  const patchData = useCallback(
    (patch: Partial<CustomProfile['data']>) =>
      setProfile((prev) => ({ ...prev, data: { ...prev.data, ...patch } })),
    [],
  );
  const patch = useCallback(
    (next: Partial<CustomProfile>) => setProfile((prev) => ({ ...prev, ...next })),
    [],
  );

  const handleSave = () => {
    const errs = serverErrors(profile);
    if (errs.name || errs.address) {
      setShowErrors(true);
      setSection('server');
      return;
    }
    // A profile always has a gamemode; without any, bots stay where they join.
    const data = profile.data.gamemodes?.length
      ? profile.data
      : {
          ...profile.data,
          gamemodes: [DEFAULT_GAMEMODE],
          joinBehaviours: { [gamemodeKey(DEFAULT_GAMEMODE)]: { kind: 'direct' as const } },
        };
    // Normalise last so every gamemode-keyed field is pruned to the
    // canonical gamemode list — a removal can't leave a dangling reference.
    const cleaned = normalizeProfileGamemodes({ ...profile, data });
    const toSave: CustomProfile = {
      ...cleaned,
      predefined: false,
      updatedAt: Date.now(),
      data: {
        ...cleaned.data,
        id: cleaned.id,
        name: cleaned.data.name.trim(),
        shortName: cleaned.data.shortName || cleaned.data.name.trim().slice(0, 12),
        ips: (cleaned.data.ips ?? []).filter(Boolean),
        defaultGamemode: cleaned.data.defaultGamemode || cleaned.data.gamemodes[0],
      },
    };
    upsertCustomProfile(toSave);
    message.success(mode === 'edit' ? 'Profile updated' : 'Profile created');
    if (onboardingDraft) {
      switchServer(toSave.id);
      navigate('/intro?stage=ready');
      return;
    }
    navigate('/profiles');
  };

  const leave = () => navigate(onboardingDraft ? '/intro?stage=create' : '/profiles');
  const handleCancel = () => {
    if (JSON.stringify(profile) === initialJson.current) return leave();
    modal.confirm({
      title: 'Discard your changes?',
      okText: 'Discard',
      okButtonProps: { danger: true },
      cancelText: 'Keep editing',
      onOk: leave,
    });
  };

  const gamemodesValue: GamemodesValues = {
    gamemodes: profile.data.gamemodes ?? [],
    kitGamemodes: profile.data.kitGamemodes ?? [],
    defaultGamemode: profile.data.defaultGamemode ?? '',
    joinBehaviours: profile.data.joinBehaviours ?? {},
  };

  return (
    <div style={{ padding: token.paddingLG, background: token.colorBgLayout }}>
      <Card
        variant="borderless"
        styles={{ body: { padding: token.paddingLG, height: '100%' } }}
        style={{
          maxWidth: 1100,
          height: 'calc(100vh - 4rem)',
          overflow: 'hidden',
          margin: '0 auto',
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Flex gap={token.marginXL} style={{ height: '100%' }}>
          <WizardSidebar
            profile={profile}
            current={section}
            onSelect={setSection}
            serverInvalid={!!(errors.name || errors.address)}
          />

          <Flex vertical style={{ flex: 1, minWidth: 0, height: '100%' }}>
            <div style={{ flex: 1, overflow: 'auto', paddingRight: token.padding, paddingBottom: token.padding }}>
              {section === 'server' && (
                <StepServer
                  data={profile.data}
                  onChange={patchData}
                  errors={errors}
                  autofill={mode === 'new'}
                />
              )}
              {section === 'gamemodes' && (
                <StepGamemodes value={gamemodesValue} onChange={patchData} />
              )}
              {section === 'ranks' && (
                <StepRanksGkits
                  gamemodes={profile.data.gamemodes ?? []}
                  value={profile.gamemodes}
                  onChange={(gamemodes) => patch({ gamemodes })}
                />
              )}
              {section === 'appSettings' && (
                <StepDefaultSettings
                  value={profile.data.appSettingsDefaults}
                  onChange={(appSettingsDefaults) => patchData({ appSettingsDefaults })}
                />
              )}
              {section === 'scripts' && (
                <StepScripts
                  value={profile.scripts ?? []}
                  onChange={(scripts: ProfileScript[]) => patch({ scripts })}
                  disallowedPlugins={profile.disallowedPlugins ?? []}
                  onDisallowedPluginsChange={(disallowedPlugins) => patch({ disallowedPlugins })}
                />
              )}
              {section === 'profileUi' && (
                <StepProfileUi
                  value={profile.profileUiAction}
                  onChange={(profileUiAction) => patch({ profileUiAction })}
                />
              )}
              {section === 'botExtension' && (
                <StepBotExtension
                  value={profile.botExtensionAction}
                  onChange={(botExtensionAction) => patch({ botExtensionAction })}
                />
              )}
            </div>

            <Flex
              justify="flex-end"
              gap={token.marginSM}
              style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: token.padding }}
            >
              <Button onClick={handleCancel}>Cancel</Button>
              <Button type="primary" onClick={handleSave}>
                {mode === 'edit' ? 'Save changes' : 'Create profile'}
              </Button>
            </Flex>
          </Flex>
        </Flex>
      </Card>
    </div>
  );
};

export default ProfileWizard;
