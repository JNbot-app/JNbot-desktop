import React from 'react';
import {
  Button,
  Checkbox,
  Col,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Result,
  Row,
  Segmented,
  Select,
  Skeleton,
  Switch,
  Typography,
  theme,
} from 'antd';
import {
  ApiOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { MinecraftWorldInfo } from '../../../common/minecraftServers';
import type {
  CreateServerValues,
  JoinServerValues,
  ServerDialogData,
  ShareWorldValues,
} from './types';

const { Text, Paragraph, Link } = Typography;

// --- Create Server Dialog ---

interface CreateServerDialogProps {
  open: boolean;
  loading: boolean;
  error?: string;
  data: Pick<ServerDialogData, 'versions' | 'worlds'>;
  onCancel: () => void;
  onRetry: () => void;
  onAddWorldFolder: () => void;
  onSubmit: (values: CreateServerValues) => void;
}

export const CreateServerDialog: React.FC<CreateServerDialogProps> = ({
  open,
  loading,
  error,
  data,
  onCancel,
  onRetry,
  onAddWorldFolder,
  onSubmit,
}) => {
  const [form] = Form.useForm<CreateServerValues>();
  const { token } = theme.useToken();
  const worldPath = Form.useWatch('worldPath', form);
  const selectedWorld = data.worlds.find((world) => world.path === worldPath);

  return (
    <Modal
      title="Create Minecraft Server"
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText="Create Server"
      confirmLoading={loading}
      okButtonProps={{ disabled: Boolean(error) }}
      width={520}
      destroyOnHidden
    >
      {error ? (
        <Result
          status="error"
          title="Could not load versions or worlds"
          subTitle={error}
          extra={
            <Button icon={<ReloadOutlined />} onClick={onRetry}>
              Try Again
            </Button>
          }
        />
      ) : loading && !data.versions.length ? (
        <Skeleton active paragraph={{ rows: 6 }} style={{ marginTop: token.marginMD }} />
      ) : (
        <Form<CreateServerValues>
          form={form}
          layout="vertical"
          onFinish={onSubmit}
          initialValues={{ memoryMB: 2048, onlineMode: true }}
          requiredMark={false}
          clearOnDestroy
          style={{ marginTop: token.marginMD }}
        >
          <Row gutter={token.marginMD}>
            <Col xs={24} sm={14}>
              <Form.Item
                name="name"
                label="Server Name"
                rules={[
                  {
                    required: true,
                    whitespace: true,
                    message: 'Please enter a server name',
                  },
                ]}
              >
                <Input
                  maxLength={80}
                  placeholder="e.g. Survival with Friends"
                  autoFocus
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={10}>
              <Form.Item
                name="version"
                label="Fabric Version"
                rules={[{ required: true, message: 'Select a version' }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="Select version"
                  options={data.versions.map((value) => ({
                    value,
                    label: value,
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="worldPath"
            label={
              <Flex justify="space-between" align="center" style={{ width: '100%' }}>
                <span>World</span>
                <Button
                  type="link"
                  size="small"
                  icon={<FolderOpenOutlined />}
                  onClick={onAddWorldFolder}
                  style={{ padding: 0, height: 'auto' }}
                >
                  Import Folder
                </Button>
              </Flex>
            }
          >
            <Select
              allowClear
              placeholder="Create a new world"
              options={data.worlds.map(worldOption)}
            />
          </Form.Item>

          {selectedWorld && !selectedWorld.version && (
            <Form.Item
              name="allowUnknownWorldVersion"
              valuePropName="checked"
              rules={[
                {
                  validator: (_, checked) =>
                    checked
                      ? Promise.resolve()
                      : Promise.reject(
                          new Error('Please confirm the unverified world version'),
                        ),
                },
              ]}
            >
              <Checkbox>
                I understand that this world's version could not be detected.
              </Checkbox>
            </Form.Item>
          )}

          <Row gutter={token.marginMD} align="middle">
            <Col xs={24} sm={12}>
              <Form.Item name="memoryMB" label="Max Memory (RAM)">
                <InputNumber
                  min={512}
                  max={16384}
                  step={512}
                  addonAfter="MB"
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="onlineMode"
                label="Online Authentication"
                valuePropName="checked"
              >
                <Switch
                  checkedChildren="Enabled"
                  unCheckedChildren="Disabled"
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="eulaAccepted"
            valuePropName="checked"
            rules={[
              {
                validator: (_, checked) =>
                  checked
                    ? Promise.resolve()
                    : Promise.reject(new Error('You must accept the Minecraft EULA')),
              },
            ]}
            style={{ marginBottom: token.marginXS }}
          >
            <Checkbox>
              I agree to the{' '}
              <Link
                onClick={(e) => {
                  e.preventDefault();
                  window.ipcRenderer.action(
                    'OPEN_URL',
                    'https://www.minecraft.net/en-us/eula',
                  );
                }}
              >
                Minecraft EULA
              </Link>{' '}
              and server terms.
            </Checkbox>
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
};

// --- Join Server Dialog ---

interface JoinServerDialogProps {
  open: boolean;
  loading: boolean;
  onCancel: () => void;
  onSubmit: (values: JoinServerValues) => void;
}

export const JoinServerDialog: React.FC<JoinServerDialogProps> = ({
  open,
  loading,
  onCancel,
  onSubmit,
}) => {
  const [form] = Form.useForm<JoinServerValues>();
  const { token } = theme.useToken();

  return (
    <Modal
      title="Join Private Server"
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText="Join Server"
      confirmLoading={loading}
      width={480}
      destroyOnHidden
    >
      <Form<JoinServerValues>
        form={form}
        layout="vertical"
        onFinish={onSubmit}
        requiredMark={false}
        clearOnDestroy
        style={{ marginTop: token.marginMD }}
      >
        <Paragraph type="secondary" style={{ fontSize: token.fontSizeSM }}>
          Paste an invite code generated by the server host to connect privately.
        </Paragraph>
        <Form.Item
          name="invite"
          label="Server Invite Code"
          rules={[
            {
              required: true,
              whitespace: true,
              message: 'Please paste a valid invite code',
            },
          ]}
        >
          <Input.TextArea
            rows={4}
            placeholder="jnbot-mc:v1:..."
            autoFocus
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

// --- Share World Dialog ---

interface ShareWorldDialogProps {
  open: boolean;
  loading: boolean;
  error?: string;
  data: Pick<ServerDialogData, 'versions' | 'bridgeClients'>;
  onCancel: () => void;
  onRetry: () => void;
  onSubmit: (values: ShareWorldValues) => void;
}

export const ShareWorldDialog: React.FC<ShareWorldDialogProps> = ({
  open,
  loading,
  error,
  data,
  onCancel,
  onRetry,
  onSubmit,
}) => {
  const [form] = Form.useForm<ShareWorldValues>();
  const { token } = theme.useToken();
  const mode = Form.useWatch('mode', form) ?? 'client';
  const clientId = Form.useWatch('clientId', form);
  const selectedClient = data.bridgeClients.find(
    (client) => client.clientId === clientId,
  );

  return (
    <Modal
      title="Share Minecraft World"
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText="Start Sharing"
      confirmLoading={loading}
      okButtonProps={{ disabled: Boolean(error) }}
      width={500}
      destroyOnHidden
    >
      {error ? (
        <Result
          status="error"
          title="Could not load connection options"
          subTitle={error}
          extra={
            <Button icon={<ReloadOutlined />} onClick={onRetry}>
              Try Again
            </Button>
          }
        />
      ) : loading && !data.versions.length ? (
        <Skeleton active paragraph={{ rows: 5 }} style={{ marginTop: token.marginMD }} />
      ) : (
        <Form<ShareWorldValues>
          form={form}
          layout="vertical"
          onFinish={onSubmit}
          initialValues={{ mode: 'client', cheatsAllowed: false }}
          requiredMark={false}
          clearOnDestroy
          style={{ marginTop: token.marginMD }}
        >
          <Form.Item name="mode" label="Connection Method">
            <Segmented
              block
              options={[
                {
                  value: 'client',
                  label: (
                    <Flex align="center" justify="center" gap={token.marginXS}>
                      <ApiOutlined />
                      <span>JNbot Client</span>
                    </Flex>
                  ),
                },
                {
                  value: 'manual',
                  label: (
                    <Flex align="center" justify="center" gap={token.marginXS}>
                      <GlobalOutlined />
                      <span>LAN Port</span>
                    </Flex>
                  ),
                },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="name"
            label="World Name"
            rules={[
              {
                required: true,
                whitespace: true,
                message: 'Please enter a name for the shared world',
              },
            ]}
          >
            <Input maxLength={80} placeholder="e.g. My Survival World" />
          </Form.Item>

          {mode === 'manual' ? (
            <Row gutter={token.marginMD}>
              <Col xs={24} sm={14}>
                <Form.Item
                  name="version"
                  label="Minecraft Version"
                  rules={[{ required: true, message: 'Choose a version' }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="Select version"
                    options={data.versions.map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={10}>
                <Form.Item
                  name="port"
                  label="LAN Port"
                  rules={[{ required: true, message: 'Enter port number' }]}
                >
                  <InputNumber
                    min={1}
                    max={65535}
                    placeholder="25565"
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            <>
              <Form.Item
                name="clientId"
                label="Running Client Instance"
                rules={[
                  { required: true, message: 'Choose a running client instance' },
                ]}
                extra={
                  !data.bridgeClients.length && (
                    <Text type="warning" style={{ fontSize: token.fontSizeSM - 1 }}>
                      No active client detected. Launch Minecraft with JNbot Client first.
                    </Text>
                  )
                }
              >
                <Select
                  placeholder={
                    data.bridgeClients.length
                      ? 'Select connected client'
                      : 'No connected clients found'
                  }
                  options={data.bridgeClients.map((client) => ({
                    value: client.clientId,
                    label: `${client.username || client.clientId}${
                      client.mcVersion ? ` (v${client.mcVersion})` : ''
                    }`,
                  }))}
                />
              </Form.Item>

              {!selectedClient?.mcVersion && (
                <Form.Item
                  name="version"
                  label="Minecraft Version"
                  rules={[{ required: true, message: 'Choose a version' }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="Select version"
                    options={data.versions.map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </Form.Item>
              )}

              <Form.Item
                name="cheatsAllowed"
                valuePropName="checked"
                style={{ marginBottom: token.marginXS }}
              >
                <Checkbox>Allow commands and cheats for joining players</Checkbox>
              </Form.Item>
            </>
          )}
        </Form>
      )}
    </Modal>
  );
};

const worldOption = (world: MinecraftWorldInfo) => ({
  value: world.path,
  label: `${world.name}${world.version ? ` (v${world.version})` : ''}`,
});
