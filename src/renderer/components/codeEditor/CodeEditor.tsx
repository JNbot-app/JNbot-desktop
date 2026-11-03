import './monaco';
import Editor, { OnChange, OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { useEffect, FC, useCallback, useRef } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import useApp from '../../hooks/useApp';
import { Spin } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { MacroInfo } from '../../../main/src/types';
//@ts-ignore
import autoCompleteText from '../../assets/autoComplete/fullApiTypes.txt?raw';
//@ts-ignore
import profileUiTypesText from '../../assets/autoComplete/profileUiTypes.txt?raw';
import SidePanel from '../other/botSideBar/SidePanel';

export type EditorInstance = monaco.editor.IStandaloneCodeEditor;

type CodeEditorProps = {
  macroInfo: MacroInfo;
  codeRef: React.MutableRefObject<string>;
  editorRef: React.MutableRefObject<EditorInstance | null>;

  activeTab: string | null;
  setActiveTab: (tab: string | null) => void;
  /** Bumped by the Run button to re-run the profile-UI preview. */
  previewNonce: number;

  code: string | null;
  editorDetails: React.MutableRefObject<{
    needUpdate: boolean;
    loaded: boolean;
    lastUpdated: number;
  }>;
};

const CodeEditor: FC<CodeEditorProps> = ({
  macroInfo,
  code,
  codeRef,
  editorRef,
  activeTab,
  editorDetails,
  setActiveTab,
  previewNonce,
}) => {
  const { theme } = useApp();
  const libsRef = useRef<monaco.IDisposable[]>([]);
  const hasRuntimeMarker = useRef(false);

  useEffect(() => () => libsRef.current.forEach((lib) => lib.dispose()), []);

  // Mark the line a runtime error came from and scroll it into view.
  useEffect(
    () =>
      window.ipcRenderer.on(
        'CODE_MACRO_ERROR',
        (err: { pluginId?: string; line?: number; name?: string; message?: string }) => {
          const model = editorRef.current?.getModel();
          if (!model || !err.line || err.pluginId !== macroInfo.pluginId) return;
          const line = Math.min(err.line, model.getLineCount());
          monaco.editor.setModelMarkers(model, 'runtime', [
            {
              severity: monaco.MarkerSeverity.Error,
              message: `${err.name ?? 'Error'}: ${err.message ?? ''}`,
              startLineNumber: line,
              startColumn: model.getLineFirstNonWhitespaceColumn(line),
              endLineNumber: line,
              endColumn: model.getLineMaxColumn(line),
            },
          ]);
          hasRuntimeMarker.current = true;
          editorRef.current?.revealLineInCenterIfOutsideViewport(line);
        },
      ),
    [macroInfo.pluginId],
  );

  useEffect(() => {
    if (!macroInfo.pluginId) return;
    const saveInterval = setInterval(() => saveScript(), 30000);
    return () => {
      clearInterval(saveInterval);
      saveScript(true);
    };
  }, [macroInfo]);

  const handleEditorChange: OnChange = (value) => {
    editorDetails.current.needUpdate = true;
    codeRef.current = value ?? '';
    const model = editorRef.current?.getModel();
    if (hasRuntimeMarker.current && model) {
      hasRuntimeMarker.current = false;
      monaco.editor.setModelMarkers(model, 'runtime', []);
    }
  };

  const saveScript = (forced = false) => {
    const { needUpdate, loaded, lastUpdated } = editorDetails.current;
    if (
      needUpdate &&
      loaded &&
      (forced || Date.now() - lastUpdated > 60000) &&
      codeRef.current.length > 0
    ) {
      editorDetails.current.needUpdate = false;
      editorDetails.current.lastUpdated = Date.now();
      window.ipcRenderer.action('SAVE_MACRO', {
        pluginId: macroInfo.pluginId,
        code: { code: codeRef.current },
      });
    }
  };

  const handleEditorDidMount: OnMount = useCallback(
    (editor) => {
      editorRef.current = editor;
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
        await editor.getAction('editor.action.formatDocument')?.run();
        saveScript(true);
      });

      // Profile-UI plugins get a tailored autocomplete that documents the
      // Builder API + `args`. Everything else falls back to the full bot
      // API surface.
      const lib =
        macroInfo.scriptType === 'profileUi' ? profileUiTypesText : autoCompleteText;
      const libName =
        macroInfo.scriptType === 'profileUi'
          ? 'ProfileUiAutoComplete.d.ts'
          : 'EditorAutoComplete.d.ts';
      // Register the API surface for both JS and TS plugins so autocomplete
      // works regardless of the plugin's language.
      const { typescript } = monaco.languages;
      libsRef.current = [
        typescript.javascriptDefaults.addExtraLib(lib, libName),
        typescript.typescriptDefaults.addExtraLib(lib, libName),
      ];
    },
    [macroInfo.scriptType],
  );

  const editorLanguage =
    macroInfo.language === 'ts' ? 'typescript' : 'javascript';

  return (
    <PanelGroup direction="horizontal" style={{ height: '100%' }}>
      <Panel defaultSize={70} id="editor-panel" order={1}>
        <div className="editor-text" style={{ height: '100%', overflow: 'hidden' }}>
          {code === null ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
              }}
            >
              <Spin indicator={<LoadingOutlined style={{ fontSize: 36 }} spin />} />
            </div>
          ) : (
            <Editor
              height="100%"
              width="100%"
              language={editorLanguage}
              value={code}
              theme={theme === 'light' ? 'light' : 'vs-dark'}
              defaultValue=""
              onChange={handleEditorChange}
              onMount={handleEditorDidMount}
              options={{
                accessibilitySupport: 'off',
                fontFamily: 'Menlo Regular',
                fontSize: 13,
                renderWhitespace: 'none',
                minimap: { enabled: false },
                padding: { top: 12 },
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                renderLineHighlight: 'gutter',
              }}
            />
          )}
        </div>
      </Panel>

      {activeTab && (
        <>
          <PanelResizeHandle style={{ width: 4 }} />
          <Panel defaultSize={30} minSize={15} id="terminal-panel" order={2}>
            <SidePanel
              activeTab={activeTab}
              onClose={() => setActiveTab(null)}
              onTabChange={setActiveTab}
              preview={
                macroInfo.scriptType === 'profileUi'
                  ? { codeRef, macroInfo, nonce: previewNonce }
                  : undefined
              }
            />
          </Panel>
        </>
      )}
    </PanelGroup>
  );
};

export default CodeEditor;
