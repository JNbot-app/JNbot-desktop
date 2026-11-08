import { useState, useRef, useEffect, useCallback } from 'react';
import Editor, { type EditorInstance } from '../components/codeEditor/CodeEditor';
import Nav from '../components/codeEditor/Nav';
import { useNavigate } from 'react-router-dom';
import { Spin, Typography } from 'antd';
import { usePanelContext } from '../components/other/botSideBar/SidePanelContextProvider';
import { codeEditorValue } from './codeEditorValue';

const CodeEditor = () => {
  const codeRef = useRef('');
  const editorRef = useRef<EditorInstance | null>(null);
  const [macroInfo, setMacroInfo] = useState<any>(null);
  const [code, setCode] = useState<string | null>(null);
  const navigate = useNavigate();

  // The side panel state is shared across the whole app via the panel context,
  // so the open/closed tab is preserved when navigating to/from the editor.
  const { panel, setPanel } = usePanelContext();
  const activeTab = panel.active ? panel.tab : null;
  const setActiveTab = useCallback(
    (tab: string | null) =>
      setPanel((prev) =>
        tab === null
          ? { ...prev, active: false }
          : { ...prev, active: true, tab },
      ),
    [setPanel],
  );

  // Each Run click opens the preview tab and bumps the nonce so the preview
  // re-runs against the latest editor source (even if already open).
  const [previewNonce, setPreviewNonce] = useState(0);
  const runPreview = useCallback(() => {
    setActiveTab('preview');
    setPreviewNonce((n) => n + 1);
  }, [setActiveTab]);

  const editorDetails = useRef({
    needUpdate: false,
    loaded: false,
    lastUpdated: 0,
  });

  // Fetch once on mount; requestCode is not memoized and would refetch every render.
  /* oxlint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    requestCode();
  }, []);

  /* oxlint-enable react-hooks/exhaustive-deps */
  // When the window regains focus (e.g. after editing the plugin in an external
  // editor) reload the canonical file — but never clobber unsaved in-app edits.
  // The focus listener is registered once; requestCode only reads refs.
  /* oxlint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const onFocus = () => {
      if (!editorDetails.current.needUpdate) requestCode();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  /* oxlint-enable react-hooks/exhaustive-deps */
  const requestCode = async () => {
    const pluginId = window.location.href
      .match(/\/code\/[A-z0-9]+/)?.[0]
      .replace('/code/', '');
    if (!pluginId) {
      navigate('/plugins');
      return;
    }

    const plugin = await window.ipcRenderer.get<{
      status: 'success' | 'error';
      error?: string;
      code?: string | { code: string };
      info?: any;
    }>('MACRO_CODE', pluginId);

    if (plugin.status === 'error') {
      window.ipcRenderer.action('PING', [
        'snackbar',
        { title: plugin.error, variant: 'error' },
      ]);
      return navigate('/plugins');
    }
    const source = codeEditorValue(plugin.code);
    if (source === null) {
      window.ipcRenderer.action('PING', [
        'snackbar',
        { title: 'Plugin code is invalid', variant: 'error' },
      ]);
      return navigate('/plugins');
    }

    editorDetails.current.loaded = true;
    setCode(source);
    setMacroInfo(plugin.info);
    codeRef.current = source;
  };

  if (macroInfo === null) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 131,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
        }}
      >
        <Spin size="large" />
        <Typography.Title level={4} style={{ margin: 0 }}>
          Loading Plugin...
        </Typography.Title>
        <Typography.Text style={{ maxWidth: 300, textAlign: 'center' }}>
          Preparing your code editor environment
        </Typography.Text>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 131,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Nav
        setMacroInfo={setMacroInfo}
        pluginInfo={macroInfo}
        onSelectActiveTab={setActiveTab}
        onRunPreview={runPreview}
        code={codeRef}
        editorRef={editorRef}
      />
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          codeRef={codeRef}
          editorRef={editorRef}
          macroInfo={macroInfo}
          setMacroInfo={setMacroInfo}
          code={code}
          editorDetails={editorDetails}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          previewNonce={previewNonce}
        />
      </div>
    </div>
  );
};

export default CodeEditor;
