import type { AltEditorPanelData } from 'renderer/components/other/botSideBar/panelTabs';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Collapse,
  Flex,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Typography,
  type InputRef,
} from 'antd';
import {
  LockOutlined,
  LogoutOutlined,
  SaveOutlined,
  StarOutlined,
  TrophyOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { AltWithData, ServerAltInfo } from '../../../main/src/types';
import {
  selectAlts,
  selectAppSettings,
  selectJNdata,
  saveAlt,
  useSettingsStore,
} from '../../redux/settings';
import { getServerMeta } from '../../../common/serverInfo';
import { accountAuthenticationError } from '../../../common/serverAuthentication';
import { usePanelContext } from '../other/botSideBar/SidePanelContextProvider';
import useAppApi from 'renderer/hooks/useAppApi';
import OnboardingHint from '../intro/OnboardingHint';

type AltFormValues = {
  username: string;
  password?: string;
  premium?: boolean;
  ranks?: Record<string, string | undefined>;
  gkits?: Record<string, string[] | undefined>;
};

const emptyValues = (): AltFormValues => ({
  username: '',
  password: '',
  premium: false,
  ranks: {},
  gkits: {},
});

const valuesFromAlt = (alt: AltWithData): AltFormValues => ({
  username: alt.username,
  password: alt.data?.password ?? '',
  premium: alt.data?.premium ?? false,
  ranks: { ...(alt.data?.ranks ?? {}) },
  gkits: Object.fromEntries(
    Object.entries(alt.data?.gkits ?? {}).map(([key, value]) => [
      key,
      [...value],
    ]),
  ),
});

const serverDataFromValues = (
  values: AltFormValues,
  premium = values.premium === true,
): ServerAltInfo => ({
  premium,
  password: values.password?.trim() || undefined,
  ranks: Object.fromEntries(
    Object.entries(values.ranks ?? {}).filter(([, rank]) => Boolean(rank)),
  ) as Record<string, string>,
  gkits: Object.fromEntries(
    Object.entries(values.gkits ?? {}).filter(
      ([, gkits]) => Array.isArray(gkits) && gkits.length > 0,
    ),
  ) as Record<string, string[]>,
});

const AltEditorPanel = ({ data }: { data: AltEditorPanelData }) => {
  const [form] = Form.useForm<AltFormValues>();
  const usernameRef = useRef<InputRef>(null);
  const passwordRef = useRef<InputRef>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const loadedEditorRef = useRef<string | null>(null);
  const { setPanel } = usePanelContext();
  const alts = useSettingsStore(selectAlts);
  const profileId = useSettingsStore((state) => state.selectedProfileId);
  const [loggingOut, setLoggingOut] = useState(false);
  const jndata = useSettingsStore(selectJNdata);
  const appSettings = useSettingsStore(selectAppSettings);
  const server = appSettings.server || jndata.serverList?.[0] || '';
  const serverMeta = getServerMeta(jndata, server);
  const onlineMode = serverMeta.onlineMode;
  const isEditing = Boolean(data.originalUsername);
  const { message } = useAppApi();
  const editingAlt = useMemo(
    () =>
      data.originalUsername
        ? alts.find(
            (alt) =>
              alt.username.toLowerCase() ===
              data.originalUsername?.toLowerCase(),
          )
        : undefined,
    [alts, data.originalUsername],
  );
  const gamemodes = useMemo(
    () => Object.entries(jndata.servers?.[server] ?? {}),
    [jndata, server],
  );
  const editorKey = `${server}:${data.originalUsername?.toLowerCase() ?? ''}`;

  useEffect(() => {
    if (loadedEditorRef.current === editorKey) return;
    loadedEditorRef.current = editorKey;
    form.setFieldsValue(editingAlt ? valuesFromAlt(editingAlt) : emptyValues());
  }, [editorKey, editingAlt, form]);

  const logoutMicrosoft = async () => {
    if (!editingAlt || !profileId || loggingOut) return;
    setLoggingOut(true);
    try {
      await window.messenger.profileRequest<boolean>(
        profileId,
        'MC_LOGOUT_MICROSOFT',
        {
          username: editingAlt.username,
        },
      );
      message.success(
        'Logged out of Microsoft. You’ll need to sign in again next time you join.',
      );
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : 'Could not log out of Microsoft.',
      );
    } finally {
      setLoggingOut(false);
    }
  };

  const save = (values: AltFormValues) => {
    const username = values.username.trim();
    const alt: AltWithData = {
      username,
      UID: editingAlt?.UID,
      data: serverDataFromValues(values, onlineMode || values.premium === true),
    };

    saveAlt({ alt, originalUsername: editingAlt?.username });
    message.success(
      isEditing ? `${username} updated` : `${username} added to this profile`,
    );

    if (!isEditing) {
      form.resetFields();
      form.setFieldsValue(emptyValues());
      requestAnimationFrame(() => usernameRef.current?.focus());
      return;
    }

    loadedEditorRef.current = `${server}:${username.toLowerCase()}`;
    setPanel((panel) => ({
      ...panel,
      data: { originalUsername: username } satisfies AltEditorPanelData,
    }));
  };

  const validateUsername = (_: unknown, value?: string) => {
    const username = value?.trim() ?? '';
    if (username.length < 3)
      return Promise.reject(new Error('Use at least 3 characters'));
    if (username.length > 16)
      return Promise.reject(new Error('Use no more than 16 characters'));
    if (!/^[A-Za-z0-9_]+$/.test(username))
      return Promise.reject(
        new Error('Only letters, numbers, and underscores are allowed'),
      );
    const duplicate = alts.some(
      (alt) =>
        alt.username.toLowerCase() === username.toLowerCase() &&
        alt.username.toLowerCase() !== editingAlt?.username.toLowerCase(),
    );
    return duplicate
      ? Promise.reject(new Error('This alt already exists'))
      : Promise.resolve();
  };

  if (isEditing && !editingAlt) {
    return (
      <Flex vertical align="center" justify="center" style={{ height: '100%' }}>
        <Typography.Text type="secondary">
          This alt is no longer available.
        </Typography.Text>
      </Flex>
    );
  }

  const optionalContent = (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      {gamemodes.length === 0 ? (
        <Typography.Text type="secondary">
          This profile has no rank or GKit options.
        </Typography.Text>
      ) : (
        gamemodes.map(([gamemode, config]) => {
          const key = gamemode.toLowerCase();
          return (
            <Card
              key={gamemode}
              size="small"
              title={gamemode.replace(/_/g, ' ')}
              styles={{ header: { textTransform: 'capitalize' } }}
            >
              <Form.Item name={['ranks', key]} label="Rank">
                <Select
                  allowClear
                  placeholder="No rank"
                  options={Object.entries(config.ranks ?? {}).map(
                    ([rank, rankInfo]) => ({
                      value: rank,
                      label: (
                        <span style={{ color: rankInfo.color }}>{rank}</span>
                      ),
                    }),
                  )}
                />
              </Form.Item>
              <Form.Item
                name={['gkits', key]}
                label="GKits"
                style={{ marginBottom: 0 }}
              >
                <Select
                  mode="multiple"
                  allowClear
                  maxTagCount="responsive"
                  placeholder="No GKits"
                  options={Object.keys(config.gkits ?? {}).map((gkit) => ({
                    value: gkit,
                    label: gkit,
                  }))}
                />
              </Form.Item>
            </Card>
          );
        })
      )}
    </Space>
  );

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={emptyValues()}
      onFinish={save}
      requiredMark={false}
      style={{ maxWidth: 560, margin: '0 auto' }}
    >
      <Form.Item
        name="username"
        label="Minecraft username"
        rules={[{ validator: validateUsername }]}
      >
        <Input
          ref={usernameRef}
          autoFocus
          autoComplete="off"
          prefix={<UserOutlined />}
          placeholder="Username"
        />
      </Form.Item>

      <Form.Item
        noStyle
        shouldUpdate={(previous, current) =>
          previous.premium !== current.premium
        }
      >
        {({ getFieldValue }) => {
          const premium = onlineMode || getFieldValue('premium');
          return (
            <>
              {!onlineMode && (
                <Form.Item
                  name="password"
                  label={`${serverMeta.name ?? server} password`}
                  rules={[
                    {
                      validator: (_, value?: string) => {
                        const error = accountAuthenticationError(
                          { premium: false, password: value },
                          false,
                        );
                        return error
                          ? Promise.reject(new Error(error))
                          : Promise.resolve();
                      },
                    },
                  ]}
                >
                  <Input.Password
                    ref={passwordRef}
                    autoComplete="new-password"
                    prefix={<LockOutlined />}
                    placeholder="Password"
                  />
                </Form.Item>
              )}

              {!onlineMode && (
                <Form.Item
                  name="premium"
                  label="Account type"
                  valuePropName="checked"
                >
                  <Switch
                    checkedChildren={
                      <>
                        <StarOutlined /> Premium
                      </>
                    }
                    unCheckedChildren="Cracked"
                  />
                </Form.Item>
              )}

              {premium && editingAlt?.data.premium && (
                <Popconfirm
                  title="Log out of Microsoft?"
                  description="Clears the saved session on this device."
                  okText="Log out"
                  okButtonProps={{ danger: true }}
                  onConfirm={logoutMicrosoft}
                >
                  <Button
                    danger
                    icon={<LogoutOutlined />}
                    loading={loggingOut}
                    disabled={!profileId}
                    style={{ marginBottom: 16 }}
                  >
                    Log out of Microsoft
                  </Button>
                </Popconfirm>
              )}
            </>
          );
        }}
      </Form.Item>

      <Collapse
        ghost
        style={{ margin: '4px -12px 20px' }}
        items={[
          {
            key: 'extras',
            forceRender: true,
            label: (
              <Space>
                <TrophyOutlined />
                Ranks & GKits
                <Typography.Text type="secondary">(optional)</Typography.Text>
              </Space>
            ),
            children: optionalContent,
          },
        ]}
      />

      <Flex justify="flex-end" gap={8}>
        {isEditing && (
          <Button
            onClick={() =>
              form.setFieldsValue(valuesFromAlt(editingAlt as AltWithData))
            }
          >
            Reset
          </Button>
        )}
        <Button
          type="primary"
          htmlType="submit"
          icon={<SaveOutlined />}
          id="save-alt-tutorial-step"
          ref={saveRef}
        >
          {isEditing ? 'Save changes' : 'Add alt'}
        </Button>
      </Flex>
      <OnboardingHint
        id="alt"
        steps={[
          {
            title: 'Enter your Minecraft username',
            description: 'This is the account your bot joins the server with.',
            target: () => usernameRef.current?.input,
          },
          ...(onlineMode
            ? []
            : [
                {
                  title: 'Server password',
                  description:
                    'The password you use for /login on this server. Turn on Premium below for a Microsoft account instead.',
                  target: () => passwordRef.current?.input,
                },
              ]),
          {
            title: 'Save your alt',
            description: 'Press Add alt. Ranks and gkits are optional.',
            target: () => saveRef.current,
          },
        ]}
      />
    </Form>
  );
};

export default AltEditorPanel;
