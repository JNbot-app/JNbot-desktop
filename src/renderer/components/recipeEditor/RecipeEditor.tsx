import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { Button, Splitter, Switch, theme, Tooltip, Typography } from 'antd';
import { produce } from 'immer';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useNavigate } from 'react-router-dom';
import { getRecipeEvent } from '../../../common/recipeCatalog';
import { analyzeRecipeBotEffects } from '../../../common/recipeAnalysis';
import {
  createRecipeId,
  literal,
  normalizeRecipeDocument,
  type RecipeDefinitionV3,
  type RecipeDocumentV3,
  type RecipeParameter,
  type RecipeStep,
} from '../../../common/recipeV3';
import {
  validateRecipeDocument,
  type RecipeValidationIssue,
} from '../../../common/recipeValidation';
import type { MacroInfo } from '../../../main/src/types';
import {
  savePlugin,
  selectScripts,
  useSettingsStore,
} from '../../redux/settings';
import PluginSettingsModal from '../codeEditor/PluginSettingsModal';
import SidePanel from '../other/botSideBar/SidePanel';
import { usePanelContext } from '../other/botSideBar/SidePanelContextProvider';
import RecipeActionLibrary from './RecipeActionLibrary';
import RecipeCheckPanel from './RecipeCheckPanel';
import DeferredRecipeInput from './DeferredRecipeInput';
import RecipeFunctionInterface from './RecipeFunctionInterface';
import RecipeNavigation from './RecipeNavigation';
import RecipeQuickAdd from './RecipeQuickAdd';
import StepList from './RecipeSteps';
import {
  clone,
  appendScope,
  botPropertyScope,
  canInsertLibraryItem,
  canInsertStep,
  createActionStep,
  createLogicStep,
  findContainingList,
  findStep,
  getStepTitle,
  mutableListAtPath,
  mutateStep,
  pathKey,
  renewStepIds,
  stepOutputScope,
  stepProvidesBot,
  type InsertTarget,
  type RecipeDragData,
  type ScopeValue,
} from './recipeEditorUtils';
import './RecipeEditor.css';
import { IoMdUndo, IoMdRedo } from 'react-icons/io';

const platform = (window as any).platform as NodeJS.Platform | undefined;
const isMac = platform === 'darwin' && !window.web;
const isWin = platform === 'win32' && !window.web;

const RecipeEditor: React.FC<{
  document: RecipeDocumentV3;
  pluginId: string;
  pluginInfo: MacroInfo;
  readOnly?: boolean;
}> = ({
  document: initialDocument,
  pluginId,
  pluginInfo: initialPluginInfo,
  readOnly = false,
}) => {
  const navigate = useNavigate();
  const scripts = useSettingsStore(selectScripts);
  const { token } = theme.useToken();
  const { panel, setPanel } = usePanelContext();
  useEffect(() => {
    if (panel.active && panel.tab === 'preview') {
      setPanel((current) => ({ ...current, tab: 'activeBots' }));
    }
  }, [panel.active, panel.tab, setPanel]);
  const [history, setHistory] = useState<{
    past: RecipeDocumentV3[];
    present: RecipeDocumentV3;
    future: RecipeDocumentV3[];
  }>(() => ({
    past: [],
    present: normalizeRecipeDocument(clone(initialDocument)),
    future: [],
  }));
  const [pluginInfo, setPluginInfo] = useState(initialPluginInfo);
  const document = history.present;
  const [selectedRecipeId, setSelectedRecipeId] = useState(
    document.recipes[0]?.id ?? '',
  );
  const selectedRecipe =
    document.recipes.find((recipe) => recipe.id === selectedRecipeId) ??
    document.recipes[0];
  const [target, setTarget] = useState<InsertTarget>({
    recipeId: selectedRecipe?.id ?? '',
    path: [],
    index: selectedRecipe?.steps.length ?? 0,
  });
  const [dirty, setDirty] = useState(false);
  const [activeStepId, setActiveStepId] = useState<string>();
  const [errorStepId, setErrorStepId] = useState<string>();
  const [isStarting, setIsStarting] = useState(false);
  const [showPluginSettings, setShowPluginSettings] = useState(false);
  const [activeDrag, setActiveDrag] = useState<RecipeDragData>();
  const [quickTarget, setQuickTarget] = useState<InsertTarget>();
  const initial = useRef(true);
  const latestRef = useRef({ document, dirty });
  latestRef.current = { document, dirty };
  const validation = useMemo(
    () => validateRecipeDocument(document),
    [document],
  );
  const botEffects = useMemo(
    () => analyzeRecipeBotEffects(document),
    [document],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerHits = pointerWithin(args);
    return pointerHits.length ? pointerHits : closestCenter(args);
  }, []);

  const commit = useCallback(
    (update: (draft: RecipeDocumentV3) => void) => {
      if (readOnly) return;
      setHistory((current) => ({
        past: [...current.past.slice(-49), current.present],
        present: produce(current.present, update),
        future: [],
      }));
      setDirty(true);
    },
    [readOnly],
  );

  const undo = useCallback(() => {
    if (readOnly || !history.past.length) return;
    setHistory((current) => {
      if (!current.past.length) return current;
      return {
        past: current.past.slice(0, -1),
        present: current.past[current.past.length - 1],
        future: [current.present, ...current.future],
      };
    });
    setDirty(true);
  }, [history.past.length, readOnly]);

  const redo = useCallback(() => {
    if (readOnly || !history.future.length) return;
    setHistory((current) => {
      if (!current.future.length) return current;
      return {
        past: [...current.past, current.present],
        present: current.future[0],
        future: current.future.slice(1),
      };
    });
    setDirty(true);
  }, [history.future.length, readOnly]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.matches('input, textarea, [role="textbox"]')
      )
        return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo]);

  const save = useCallback(() => {
    if (readOnly) return;
    window.ipcRenderer.action('SAVE_MACRO', { pluginId, code: document });
    setDirty(false);
  }, [document, pluginId, readOnly]);

  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    if (!dirty) return;
    const timeout = window.setTimeout(save, 900);
    return () => window.clearTimeout(timeout);
  }, [document, dirty, save]);

  useEffect(
    () => () => {
      if (!readOnly && latestRef.current.dirty) {
        window.ipcRenderer.action('SAVE_MACRO', {
          pluginId,
          code: latestRef.current.document,
        });
      }
    },
    [pluginId, readOnly],
  );

  useEffect(() => {
    const removeActive = window.ipcRenderer.on(
      'active-component',
      (component: { componentId?: string }) =>
        setActiveStepId(component.componentId),
    );
    const removeError = window.ipcRenderer.on(
      'component-error',
      (error: {
        component?: { componentId?: string };
        source?: { recipeId?: string };
      }) => {
        const id = error.component?.componentId;
        const recipe = latestRef.current.document.recipes.find(
          (item) => item.id === error.source?.recipeId,
        );
        if (recipe) {
          setSelectedRecipeId(recipe.id);
          setTarget({
            recipeId: recipe.id,
            path: [],
            index: recipe.steps.length,
          });
        }
        setErrorStepId(id);
        if (id)
          window.setTimeout(
            () =>
              globalThis.document
                .querySelector(`[data-step-id="${id}"]`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
            50,
          );
      },
    );
    return () => {
      removeActive();
      removeError();
    };
  }, []);

  if (!selectedRecipe) return null;

  const selectRecipe = (recipe: RecipeDefinitionV3) => {
    setSelectedRecipeId(recipe.id);
    setTarget({ recipeId: recipe.id, path: [], index: recipe.steps.length });
  };

  const updateSelectedRecipe = (update: (recipe: RecipeDefinitionV3) => void) =>
    commit((draft) => {
      const recipe = draft.recipes.find(
        (item) => item.id === selectedRecipe.id,
      );
      if (recipe) update(recipe);
    });

  const changeStep = (stepId: string, update: (step: RecipeStep) => void) =>
    updateSelectedRecipe((recipe) => mutateStep(recipe.steps, stepId, update));

  const deleteStep = (stepId: string) =>
    updateSelectedRecipe((recipe) => {
      const list = findContainingList(recipe.steps, stepId);
      const index = list?.findIndex((step) => step.id === stepId) ?? -1;
      if (list && index >= 0) list.splice(index, 1);
    });

  const copyStep = (stepId: string) =>
    updateSelectedRecipe((recipe) => {
      const list = findContainingList(recipe.steps, stepId);
      const index = list?.findIndex((step) => step.id === stepId) ?? -1;
      if (list && index >= 0)
        list.splice(index + 1, 0, renewStepIds(list[index]));
    });

  const createLibraryStep = (itemType: 'action' | 'logic', itemId: string) =>
    itemType === 'action'
      ? createActionStep(itemId)
      : createLogicStep(itemId, document);

  const insertAt = (insertTarget: InsertTarget, step: RecipeStep) => {
    commit((draft) => {
      const recipe = draft.recipes.find(
        (item) => item.id === insertTarget.recipeId,
      );
      const list = recipe && mutableListAtPath(recipe, insertTarget.path);
      if (!list) return;
      list.splice(Math.min(insertTarget.index, list.length), 0, step);
    });
    setTarget({ ...insertTarget, index: insertTarget.index + 1 });
  };

  const insertFromLibrary = (itemType: 'action' | 'logic', itemId: string) =>
    insertAt(target, createLibraryStep(itemType, itemId));

  const insertFromQuickAdd = (itemType: 'action' | 'logic', itemId: string) => {
    if (quickTarget) insertAt(quickTarget, createLibraryStep(itemType, itemId));
  };

  const targetFromDrop = (
    event: DragEndEvent,
    dragged?: RecipeDragData,
  ): InsertTarget | undefined => {
    const data = event.over?.data.current as RecipeDragData | undefined;
    if (data?.type === 'drop') return data.target;
    if (data?.type === 'step') {
      const movingDownInSameList =
        dragged?.type === 'step' &&
        dragged.recipeId === data.recipeId &&
        pathKey(dragged.path) === pathKey(data.path) &&
        dragged.index < data.index;
      return {
        recipeId: data.recipeId,
        path: data.path,
        index: data.index + (movingDownInSameList ? 1 : 0),
      };
    }
    return undefined;
  };

  const onDragStart = (event: DragStartEvent) =>
    setActiveDrag(event.active.data.current as RecipeDragData | undefined);

  const onDragEnd = (event: DragEndEvent) => {
    const dragged = event.active.data.current as RecipeDragData | undefined;
    const dropTarget = targetFromDrop(event, dragged);
    setActiveDrag(undefined);
    if (!dragged || !dropTarget) return;

    if (dragged.type === 'library') {
      if (
        !canInsertLibraryItem(
          document,
          dropTarget,
          dragged.itemType,
          dragged.itemId,
        )
      )
        return;
      insertAt(dropTarget, createLibraryStep(dragged.itemType, dragged.itemId));
      return;
    }
    if (dragged.type !== 'step' || dragged.recipeId !== dropTarget.recipeId)
      return;
    if (dropTarget.path.some((part) => part.stepId === dragged.stepId)) return;
    const draggedRecipe = document.recipes.find(
      (recipe) => recipe.id === dragged.recipeId,
    );
    const draggedStep =
      draggedRecipe && findStep(draggedRecipe.steps, dragged.stepId);
    if (!draggedStep || !canInsertStep(document, dropTarget, draggedStep))
      return;

    commit((draft) => {
      const recipe = draft.recipes.find((item) => item.id === dragged.recipeId);
      if (!recipe) return;
      const source = mutableListAtPath(recipe, dragged.path);
      if (!source) return;
      const sourceIndex = source.findIndex(
        (step) => step.id === dragged.stepId,
      );
      if (sourceIndex < 0) return;
      const [step] = source.splice(sourceIndex, 1);
      const destination = mutableListAtPath(recipe, dropTarget.path);
      if (!destination) {
        source.splice(sourceIndex, 0, step);
        return;
      }
      let destinationIndex = dropTarget.index;
      if (source === destination && sourceIndex < destinationIndex)
        destinationIndex -= 1;
      destination.splice(
        Math.max(0, Math.min(destinationIndex, destination.length)),
        0,
        step,
      );
    });
    setTarget(dropTarget);
  };

  const addEventRecipe = (eventId: string) => {
    const event = getRecipeEvent(eventId)!;
    const recipe: RecipeDefinitionV3 = {
      id: createRecipeId('event'),
      name: event.name,
      role: 'event',
      enabled: true,
      trigger: {
        kind: 'botEvent',
        eventId,
        mode: 'every',
        concurrency: 'queue',
      },
      steps: [],
    };
    commit((draft) => {
      draft.recipes.push(recipe);
    });
    selectRecipe(recipe);
  };

  const addCallable = () => {
    const recipe: RecipeDefinitionV3 = {
      id: createRecipeId('recipe'),
      name: 'Reusable recipe',
      role: 'callable',
      enabled: true,
      inputs: [],
      outputs: [],
      steps: [],
    };
    commit((draft) => {
      draft.recipes.push(recipe);
    });
    selectRecipe(recipe);
  };

  const removeRecipe = (id: string) => {
    const fallback = document.recipes.find((recipe) => recipe.role === 'onRun');
    if (!fallback) return;
    commit((draft) => {
      const index = draft.recipes.findIndex(
        (recipe) => recipe.id === id && recipe.role !== 'onRun',
      );
      if (index >= 0) draft.recipes.splice(index, 1);
    });
    selectRecipe(fallback);
  };

  const applyStarter = (type: string) => {
    const steps =
      type === 'join'
        ? [createActionStep('botJoin')]
        : type === 'chat'
          ? [createActionStep('botJoin'), createActionStep('botChat')]
          : type === 'alts'
            ? [createLogicStep('forEach', document)]
            : [];
    updateSelectedRecipe((recipe) => {
      recipe.steps = steps;
    });
    setTarget({ recipeId: selectedRecipe.id, path: [], index: steps.length });
  };

  const run = async () => {
    if (!validation.valid) {
      setActiveTab('recipe-check');
      return;
    }
    save();
    setErrorStepId(undefined);
    setIsStarting(true);
    try {
      await scripts.startScript({
        script: 'macro',
        arguments: {
          components: document,
          macroInfo: pluginInfo,
          devMode: true,
        },
        console: 'macro_console',
      });
    } finally {
      setIsStarting(false);
    }
  };
  const isRunning = scripts.isScriptActiveById(pluginId);
  const stop = () => {
    const instance = scripts.getInstanceIdsById(pluginId)[0];
    if (instance) scripts.stopAll(instance);
  };

  let triggerScope: ScopeValue[] = [
    ...(selectedRecipe.trigger?.kind === 'botEvent'
      ? (getRecipeEvent(selectedRecipe.trigger.eventId)?.outputs ?? []).map(
          (output) => ({
            key: `trigger:${output.id}`,
            label: output.label,
            group: 'event' as const,
            value: {
              kind: 'reference' as const,
              source: 'trigger' as const,
              sourceId: selectedRecipe.id,
              outputId: output.id,
            },
          }),
        )
      : []),
    ...(pluginInfo.config ?? []).flatMap((section) =>
      section.options.map((option) => ({
        key: `option:${option.id}`,
        label: option.label,
        group: 'options' as const,
        value: {
          kind: 'reference' as const,
          source: 'pluginOption' as const,
          outputId: option.id,
        },
      })),
    ),
    ...(selectedRecipe.inputs ?? []).map((input) => ({
      key: `input:${input.id}`,
      label: input.name,
      group: 'inputs' as const,
      value: {
        kind: 'reference' as const,
        source: 'recipeInput' as const,
        outputId: input.id,
      },
    })),
  ];
  if (selectedRecipe.role !== 'onRun')
    triggerScope = appendScope(triggerScope, botPropertyScope());
  let outputScope: ScopeValue[] = [...triggerScope];
  selectedRecipe.steps.forEach((step) => {
    if (step.disabled) return;
    outputScope = appendScope(outputScope, stepOutputScope(step, document));
    if (stepProvidesBot(step, botEffects))
      outputScope = appendScope(outputScope, botPropertyScope());
  });

  const addParameter = (kind: 'inputs' | 'outputs') => {
    const parameter: RecipeParameter = {
      id: createRecipeId(kind === 'inputs' ? 'input' : 'output'),
      name: kind === 'inputs' ? 'Input' : 'Result',
      type: 'string',
      defaultValue: literal(''),
    };
    updateSelectedRecipe((recipe) => {
      recipe[kind] = [...(recipe[kind] ?? []), parameter];
    });
  };

  const updateParameter = (
    kind: 'inputs' | 'outputs',
    id: string,
    update: (parameter: RecipeParameter) => void,
  ) =>
    updateSelectedRecipe((recipe) => {
      const parameter = recipe[kind]?.find((item) => item.id === id);
      if (parameter) update(parameter);
    });

  const removeParameter = (kind: 'inputs' | 'outputs', id: string) =>
    updateSelectedRecipe((recipe) => {
      recipe[kind] = recipe[kind]?.filter((parameter) => parameter.id !== id);
    });

  const focusIssue = (issue: RecipeValidationIssue) => {
    setActiveTab(null);
    const recipe = document.recipes.find((item) => item.id === issue.recipeId);
    if (recipe) selectRecipe(recipe);
    setErrorStepId(issue.stepId);
    if (issue.stepId) {
      window.setTimeout(
        () =>
          globalThis.document
            .querySelector(`[data-step-id="${issue.stepId}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        50,
      );
    }
  };

  const setActiveTab = (tab: string | null) =>
    setPanel((current) =>
      tab === null
        ? { ...current, active: false }
        : { ...current, active: true, tab },
    );
  const activeTab = panel.active ? panel.tab : null;

  const editorStyle = {
    '--recipe-bg': token.colorBgContainer,
    '--recipe-panel': token.colorBgContainer,
    '--recipe-elevated': token.colorBgElevated,
    '--recipe-fill': token.colorFillTertiary,
    '--recipe-fill-hover': token.colorFillSecondary,
    '--recipe-border': token.colorBorderSecondary,
    '--recipe-border-strong': token.colorBorder,
    '--recipe-text': token.colorText,
    '--recipe-text-secondary': token.colorTextSecondary,
    '--recipe-primary': token.colorPrimary,
    '--recipe-primary-bg': token.colorPrimaryBg,
    '--recipe-primary-border': token.colorPrimaryBorder,
    '--recipe-success': token.colorSuccess,
    '--recipe-success-bg': token.colorSuccessBg,
    '--recipe-error': token.colorError,
    '--recipe-error-bg': token.colorErrorBg,
    '--recipe-warning': token.colorWarning,
    '--recipe-warning-bg': token.colorWarningBg,
    '--recipe-shadow': token.boxShadowSecondary,
    '--recipe-radius': `${token.borderRadiusLG}px`,
    '--recipe-control-height': `${token.controlHeight}px`,
    '--recipe-component-bot': token.colorSuccess,
    '--recipe-component-timing': token.colorWarning,
    '--recipe-component-other': token.colorInfo,
    '--recipe-component-logic': token.colorPrimary,
    '--recipe-component-data': token.colorWarningActive,
    '--recipe-component-developer': token.colorError,
  } as React.CSSProperties;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragCancel={() => setActiveDrag(undefined)}
      onDragEnd={onDragEnd}
    >
      <div className="recipe-editor" style={editorStyle}>
        <header
          className="recipe-topbar"
          style={{ marginLeft: isMac ? 76 : undefined }}
        >
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => {
              save();
              navigate(-1);
            }}
          />
          <div className="recipe-title">
            <strong>{pluginInfo.name}</strong>
            <Typography.Text type="secondary">
              {readOnly
                ? 'Public preview · read only'
                : dirty
                  ? 'Saving changes…'
                  : 'All changes saved'}
            </Typography.Text>
          </div>
          <span
            className={isWin ? 'windows-controls-space no-drag' : ''}
            style={{ gap: 8, display: 'flex' }}
          >
            <Tooltip title={`Undo (${isMac ? '⌘Z' : 'Ctrl+Z'})`}>
              <Button
                disabled={readOnly || !history.past.length}
                icon={<IoMdUndo />}
                onClick={undo}
              />
            </Tooltip>
            <Tooltip title={`Redo (${isMac ? '⇧⌘Z' : 'Ctrl+Shift+Z'})`}>
              <Button
                disabled={readOnly || !history.future.length}
                icon={<IoMdRedo />}
                onClick={redo}
              />
            </Tooltip>
            <Button
              icon={<CheckCircleOutlined />}
              danger={!validation.valid}
              onClick={() => setActiveTab('recipe-check')}
            >
              {validation.valid
                ? 'Checked'
                : `${validation.issues.filter((issue) => issue.severity === 'error').length} issues`}
            </Button>
            {isRunning ? (
              <Button
                danger
                type="primary"
                icon={<StopOutlined />}
                onClick={stop}
              >
                Stop
              </Button>
            ) : (
              <Button type="primary" loading={isStarting} onClick={run}>
                Run
              </Button>
            )}

            {!readOnly && (
              <Tooltip title="Plugin settings and options">
                <Button
                  icon={<SettingOutlined />}
                  onClick={() => setShowPluginSettings(true)}
                />
              </Tooltip>
            )}
            <Tooltip title="Open logs & active bots">
              <Button
                icon={<MenuUnfoldOutlined />}
                onClick={() => setActiveTab(activeTab ? null : 'activeBots')}
              />
            </Tooltip>
          </span>
        </header>

        <div className="recipe-editor-body">
          <PanelGroup direction="horizontal">
            <Panel id="recipe-workflow" order={1} minSize={55}>
              <Splitter
                lazy
                className={`recipe-layout ${readOnly ? 'read-only' : ''}`}
              >
                <Splitter.Panel
                  defaultSize={225}
                  min={180}
                  max={360}
                  collapsible
                >
                  <RecipeNavigation
                    document={document}
                    selectedId={selectedRecipe.id}
                    readOnly={readOnly}
                    onSelect={selectRecipe}
                    onAddEvent={addEventRecipe}
                    onAddFunction={addCallable}
                    onRemove={removeRecipe}
                  />
                </Splitter.Panel>

                <Splitter.Panel min={440}>
                  <main className="recipe-workspace">
                    <div className="recipe-column">
                      <section className="recipe-trigger-card">
                        <Typography.Text
                          type="secondary"
                          className="recipe-eyebrow"
                        >
                          When this happens
                        </Typography.Text>
                        <Typography.Title level={4}>
                          {selectedRecipe.role === 'onRun'
                            ? 'Plugin is run'
                            : selectedRecipe.role === 'event' &&
                                selectedRecipe.trigger?.kind === 'botEvent'
                              ? getRecipeEvent(selectedRecipe.trigger.eventId)
                                  ?.name
                              : 'Called from another recipe'}
                        </Typography.Title>
                        <Typography.Paragraph type="secondary">
                          {selectedRecipe.role === 'event'
                            ? 'Choose whether this plugin should listen for this event after a bot joins. Its values are available in each action below.'
                            : selectedRecipe.role === 'callable'
                              ? 'A reusable recipe only runs when a Call a recipe step uses it.'
                              : 'Actions run from top to bottom.'}
                        </Typography.Paragraph>
                        {selectedRecipe.role !== 'onRun' && (
                          <DeferredRecipeInput
                            className="recipe-name-input"
                            value={selectedRecipe.name}
                            onCommit={(name) =>
                              updateSelectedRecipe((recipe) => {
                                recipe.name = name;
                              })
                            }
                          />
                        )}
                        {selectedRecipe.trigger?.kind === 'botEvent' && (
                          <div className="recipe-trigger-options">
                            <Switch
                              checked={selectedRecipe.enabled}
                              checkedChildren="Listening"
                              unCheckedChildren="Off"
                              onChange={(enabled) =>
                                updateSelectedRecipe((recipe) => {
                                  recipe.enabled = enabled;
                                })
                              }
                            />
                            <Typography.Text type="secondary">
                              {selectedRecipe.enabled
                                ? 'This listener starts after a bot joins.'
                                : 'This listener is currently off.'}
                            </Typography.Text>
                          </div>
                        )}

                        {selectedRecipe.role === 'callable' && (
                          <RecipeFunctionInterface
                            recipe={selectedRecipe}
                            scope={outputScope}
                            readOnly={readOnly}
                            onAdd={addParameter}
                            onUpdate={updateParameter}
                            onRemove={removeParameter}
                          />
                        )}
                      </section>

                      {selectedRecipe.steps.length === 0 &&
                        selectedRecipe.role === 'onRun' && (
                          <section className="recipe-empty-start">
                            <Typography.Title level={4}>
                              Start with a template
                            </Typography.Title>
                            <Typography.Paragraph type="secondary">
                              Or drag any action from the library onto the empty
                              workflow.
                            </Typography.Paragraph>
                            <div className="recipe-template-grid">
                              <Button onClick={() => applyStarter('join')}>
                                Join and log in
                              </Button>
                              <Button onClick={() => applyStarter('chat')}>
                                Join and send chat
                              </Button>
                              <Button onClick={() => applyStarter('alts')}>
                                Loop over accounts
                              </Button>
                            </div>
                          </section>
                        )}

                      <StepList
                        steps={selectedRecipe.steps}
                        recipe={selectedRecipe}
                        document={document}
                        path={[]}
                        scope={triggerScope}
                        activeStepId={activeStepId}
                        errorStepId={errorStepId}
                        selectedTarget={target}
                        readOnly={readOnly}
                        botEffects={botEffects}
                        onChange={changeStep}
                        onDelete={deleteStep}
                        onCopy={copyStep}
                        onTarget={setTarget}
                        onQuickAdd={setQuickTarget}
                      />
                    </div>
                  </main>
                </Splitter.Panel>

                {!readOnly && (
                  <Splitter.Panel
                    defaultSize={310}
                    min={230}
                    max={480}
                    collapsible
                  >
                    <RecipeActionLibrary
                      document={document}
                      target={target}
                      onInsert={insertFromLibrary}
                    />
                  </Splitter.Panel>
                )}
              </Splitter>
            </Panel>

            {activeTab && (
              <>
                <PanelResizeHandle className="recipe-panel-resize-handle" />
                <Panel
                  id="recipe-side-panel"
                  order={2}
                  defaultSize={28}
                  minSize={18}
                  maxSize={45}
                >
                  <SidePanel
                    activeTab={activeTab}
                    onClose={() => setActiveTab(null)}
                    onTabChange={setActiveTab}
                    extraTabs={[
                      {
                        key: 'recipe-check',
                        label: 'Check',
                        content: (
                          <RecipeCheckPanel
                            issues={validation.issues}
                            onFocus={focusIssue}
                          />
                        ),
                      },
                    ]}
                  />
                </Panel>
              </>
            )}
          </PanelGroup>
        </div>

        <PluginSettingsModal
          visible={showPluginSettings}
          onClose={() => setShowPluginSettings(false)}
          macroData={pluginInfo}
          onSave={(updatedPlugin) => {
            savePlugin(updatedPlugin);
            setPluginInfo(updatedPlugin);
          }}
        />
        <RecipeQuickAdd
          open={Boolean(quickTarget)}
          document={document}
          target={quickTarget ?? target}
          onClose={() => setQuickTarget(undefined)}
          onInsert={insertFromQuickAdd}
        />
      </div>

      <DragOverlay>
        {activeDrag && activeDrag.type !== 'drop' ? (
          <div className="recipe-drag-overlay" style={editorStyle}>
            {activeDrag.type === 'library'
              ? activeDrag.label
              : (() => {
                  const step = findStep(
                    selectedRecipe.steps,
                    activeDrag.stepId,
                  );
                  return step ? getStepTitle(step) : 'Move action';
                })()}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};

export default RecipeEditor;
