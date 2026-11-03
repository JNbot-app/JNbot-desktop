import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/editor.all';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { registerSnippets } from './snippets';

window.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    return label === 'typescript' || label === 'javascript'
      ? new TypeScriptWorker()
      : new EditorWorker();
  },
};

loader.config({ monaco });

// JS plugins run in a Node sandbox wrapped in an async function: there is no
// DOM, top-level await/return are valid and modules resolve at runtime. Only
// report clear mistakes (typos, unknown names, wrong argument counts); JS
// literal widening makes strict assignability errors mostly noise.
const { typescript } = monaco.languages;
typescript.javascriptDefaults.setCompilerOptions({
  target: typescript.ScriptTarget.ES2020,
  lib: ['es2020'],
  allowJs: true,
  checkJs: true,
  allowNonTsExtensions: true,
});
typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
  noSuggestionDiagnostics: true,
  diagnosticCodesToIgnore: [1108, 1375, 1378, 2307, 2322, 2345, 2792],
});

registerSnippets(monaco);
