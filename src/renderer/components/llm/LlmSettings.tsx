import { useEffect, useState } from 'react';
import { Button, Flex, Form, Input, Select, Tag, Typography } from 'antd';
import { LLM_PROVIDERS, llmProvider, type LlmProviderId } from '../../../common/llm';
import useAppApi from '../../hooks/useAppApi';
import useLlm from '../../hooks/useLlm';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The provider's live model list for the form's provider + key (or the saved key). */
function useModels(provider: LlmProviderId, apiKey: string, canList: boolean) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setModels([]);
    setError(undefined);
    if (!canList) return undefined;
    let active = true;
    // Wait until the user stops typing the key.
    const timer = setTimeout(() => {
      setLoading(true);
      window.ipcRenderer
        .get('LLM_MODELS', { provider, apiKey: apiKey || undefined })
        .then((list) => active && setModels(list))
        .catch((reason) => active && setError(errorText(reason)))
        .finally(() => active && setLoading(false));
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [provider, apiKey, canList]);

  return { models, loading, error };
}

/** Settings → General: pick an AI provider, paste a key and choose a model. */
const LlmSettings = () => {
  const { message } = useAppApi();
  const status = useLlm();
  const [provider, setProvider] = useState<LlmProviderId>(status.provider ?? 'gemini');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(status.model);
  const [busy, setBusy] = useState<'save' | 'test' | 'remove'>();
  const info = llmProvider(provider);
  const savedHere = status.provider === provider;
  // A saved key is reused while the provider stays the same.
  const hasKey = !info.keyUrl || Boolean(apiKey) || savedHere;
  const { models, loading, error } = useModels(provider, apiKey, hasKey);

  // Keep the choice valid for the loaded list: the saved model, else the first.
  useEffect(() => {
    if (models.length && !(model && models.includes(model)))
      setModel(savedHere && status.model && models.includes(status.model) ? status.model : models[0]);
  }, [models]);

  const run = async (kind: 'save' | 'test' | 'remove', action: () => Promise<unknown>) => {
    setBusy(kind);
    try {
      await action();
    } catch (reason) {
      message.error(errorText(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const save = () =>
    run('save', async () => {
      await window.ipcRenderer.get('LLM_SET_CONFIG', { provider, model, apiKey: apiKey || undefined });
      setApiKey('');
      message.success('AI settings saved');
    });

  const changeProvider = (next: LlmProviderId) => {
    setProvider(next);
    setApiKey('');
    setModel(undefined);
  };

  return (
    <Form layout="vertical" style={{ maxWidth: 520 }}>
      {status.configured && (
        <Typography.Paragraph>
          <Tag color="success">On</Tag>
          {llmProvider(status.provider).label} · {status.model}
        </Typography.Paragraph>
      )}
      <Form.Item label="Provider">
        <Select
          value={provider}
          onChange={changeProvider}
          options={LLM_PROVIDERS.map(({ id, label, note }) => ({
            value: id,
            label: (
              <Flex justify="space-between" gap={8}>
                {label}
                {note && <Typography.Text type="secondary">{note}</Typography.Text>}
              </Flex>
            ),
          }))}
        />
      </Form.Item>
      {info.keyUrl && (
        <Form.Item
          label="API key"
          extra={
            <Typography.Link href={info.keyUrl} target="_blank">
              Get a {info.label.split(' ')[0]} key
            </Typography.Link>
          }
        >
          <Input.Password
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value.trim())}
            placeholder={savedHere ? 'Saved. Paste a new key to replace it.' : 'Paste your key'}
            autoComplete="off"
          />
        </Form.Item>
      )}
      <Form.Item label="Model" validateStatus={error ? 'error' : undefined} help={error}>
        <Select
          showSearch
          value={model}
          onChange={setModel}
          loading={loading}
          disabled={!hasKey}
          placeholder={hasKey ? 'Choose a model' : 'Add a key to see the models'}
          options={models.map((id) => ({ value: id, label: id }))}
          notFoundContent={loading ? 'Loading models…' : 'No models found'}
        />
      </Form.Item>
      <Flex gap={8} wrap="wrap">
        <Button type="primary" loading={busy === 'save'} disabled={!hasKey || !model} onClick={save}>
          Save
        </Button>
        {status.configured && (
          <>
            <Button
              loading={busy === 'test'}
              onClick={() => run('test', async () => message.success(await window.ipcRenderer.get('LLM_TEST')))}
            >
              Test
            </Button>
            <Button danger loading={busy === 'remove'} onClick={() => run('remove', () => window.ipcRenderer.get('LLM_SET_CONFIG', null))}>
              Remove
            </Button>
          </>
        )}
      </Flex>
    </Form>
  );
};

export default LlmSettings;
