import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  HolderOutlined,
  PlusOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { Button, Select, Switch, Tag, Typography } from 'antd';
import React, { useState } from 'react';
import {
  getRecipeAction,
  getRecipeCollection,
  getRecipeEvent,
  recipeCollectionCatalog,
  recipeEventCatalog,
} from '../../../common/recipeCatalog';
import {
  createRecipeId,
  literal,
  type RecipeDefinitionV3,
  type RecipeDocumentV3,
  type RecipeStep,
} from '../../../common/recipeV3';
import RecipeValueEditor from './RecipeValueEditor';
import RecipeActionInput from './RecipeActionInput';
import RecipeConditionEditor from './RecipeConditionEditor';
import RecipeConditionGroupEditor from './RecipeConditionGroupEditor';
import type { RecipeBotEffect } from '../../../common/recipeAnalysis';
import DeferredRecipeInput, {
  DeferredRecipeTextArea,
} from './DeferredRecipeInput';
import {
  defaultValue,
  appendScope,
  botPropertyScope,
  getStepTitle,
  pathKey,
  stepOutputScope,
  stepProvidesBot,
  targetsEqual,
  type InsertTarget,
  type ListPathPart,
  type RecipeDragData,
  type ScopeValue,
} from './recipeEditorUtils';

type StepListProps = {
  steps: RecipeStep[];
  recipe: RecipeDefinitionV3;
  document: RecipeDocumentV3;
  path: ListPathPart[];
  scope: ScopeValue[];
  activeStepId?: string;
  errorStepId?: string;
  selectedTarget: InsertTarget;
  readOnly: boolean;
  botEffects: Map<string, RecipeBotEffect>;
  onChange: (stepId: string, update: (step: RecipeStep) => void) => void;
  onDelete: (stepId: string) => void;
  onCopy: (stepId: string) => void;
  onTarget: (target: InsertTarget) => void;
  onQuickAdd: (target: InsertTarget) => void;
};

const InsertionPoint: React.FC<{
  target: InsertTarget;
  selected: InsertTarget;
  empty?: boolean;
  readOnly: boolean;
  onTarget: (target: InsertTarget) => void;
  onQuickAdd: (target: InsertTarget) => void;
}> = ({ target, selected, empty = false, readOnly, onTarget, onQuickAdd }) => {
  const id = `drop:${target.recipeId}:${pathKey(target.path)}:${target.index}`;
  const { isOver, setNodeRef } = useDroppable({
    id,
    disabled: readOnly,
    data: { type: 'drop', target } satisfies RecipeDragData,
  });
  const active = targetsEqual(target, selected);

  return (
    <button
      ref={setNodeRef}
      type="button"
      disabled={readOnly}
      className={`recipe-insertion-point ${empty ? 'empty' : ''} ${active ? 'selected' : ''} ${isOver ? 'over' : ''}`}
      aria-label={empty ? 'Choose the first action' : 'Insert an action here'}
      onClick={() => {
        onTarget(target);
        onQuickAdd(target);
      }}
    >
      <span className="recipe-insertion-line" />
      <span className="recipe-insertion-button">
        <PlusOutlined />
      </span>
      {empty && <span>Drop an action here, or click to choose one</span>}
      <span className="recipe-insertion-line" />
    </button>
  );
};

const StepCard: React.FC<
  StepListProps & { step: RecipeStep; index: number }
> = (props) => {
  const { step, scope, onChange, path, index, recipe, readOnly } = props;
  const [expanded, setExpanded] = useState(true);
  const sortable = useSortable({
    id: step.id,
    disabled: readOnly,
    data: {
      type: 'step',
      recipeId: recipe.id,
      path,
      index,
      stepId: step.id,
    } satisfies RecipeDragData,
  });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.35 : undefined,
  };
  const update = (fn: (draft: any) => void) =>
    onChange(step.id, fn as (step: RecipeStep) => void);
  const action =
    step.kind === 'action' ? getRecipeAction(step.actionId) : undefined;
  const categoryClass = action
    ? `action-${action.category.toLowerCase()}`
    : step.kind === 'remember'
      ? 'action-data'
      : step.kind === 'developerCode'
        ? 'action-developer'
        : 'action-logic';

  const nested = (
    label: string,
    steps: RecipeStep[],
    nextPath: ListPathPart[],
    nestedScope = scope,
  ) => (
    <div className="recipe-nested">
      <div className="recipe-nested-label">
        <span>{label}</span>
        <Typography.Text type="secondary">
          {steps.length} {steps.length === 1 ? 'action' : 'actions'}
        </Typography.Text>
      </div>
      <StepList {...props} steps={steps} path={nextPath} scope={nestedScope} />
    </div>
  );

  const body = (() => {
    if (step.kind === 'action') {
      return (
        <>
          {action?.description && (
            <Typography.Paragraph
              type="secondary"
              className="recipe-step-description"
            >
              {action.description}
            </Typography.Paragraph>
          )}
          {action?.inputs.map((definition) => (
            <div className="recipe-field" key={definition.id}>
              <label>{definition.label}</label>
              <RecipeActionInput
                definition={definition}
                value={step.inputs[definition.id] ?? defaultValue(definition)}
                scope={scope}
                onChange={(value) =>
                  update((draft) => {
                    draft.inputs[definition.id] = value;
                  })
                }
              />
            </div>
          ))}
        </>
      );
    }
    if (step.kind === 'if') {
      return (
        <>
          <RecipeConditionGroupEditor
            group={step}
            scope={scope}
            title="Choose this path when"
            onChange={(change) => update((draft) => change(draft))}
          />
          {nested('Then', step.then, [
            ...path,
            { stepId: step.id, slot: 'then' },
          ])}
          {nested('Otherwise', step.otherwise, [
            ...path,
            { stepId: step.id, slot: 'otherwise' },
          ])}
        </>
      );
    }
    if (step.kind === 'repeatCount') {
      const loopScope = [
        ...scope,
        {
          key: `${step.id}:index`,
          label: 'Current iteration',
          group: 'variables' as const,
          value: {
            kind: 'reference' as const,
            source: 'loop' as const,
            sourceId: step.id,
            outputId: 'index',
          },
        },
      ];
      return (
        <>
          <div className="recipe-field recipe-field-compact">
            <label>Number of times</label>
            <RecipeValueEditor
              value={step.count}
              type="number"
              scope={scope}
              onChange={(value) =>
                update((draft) => {
                  draft.count = value;
                })
              }
            />
          </div>
          {nested(
            'Repeat these actions',
            step.steps,
            [...path, { stepId: step.id, slot: 'steps' }],
            loopScope,
          )}
        </>
      );
    }
    if (step.kind === 'repeatWhile') {
      return (
        <>
          <RecipeConditionEditor
            condition={step.condition}
            scope={scope}
            onChange={(change) => update((draft) => change(draft.condition))}
          />
          {nested('While the condition is true', step.steps, [
            ...path,
            { stepId: step.id, slot: 'steps' },
          ])}
        </>
      );
    }
    if (step.kind === 'forEach') {
      const collection = getRecipeCollection(step.collectionId ?? '');
      const loopScope = [
        ...scope,
        {
          key: `${step.id}:item`,
          label: 'Current item',
          group: 'variables' as const,
          value: {
            kind: 'reference' as const,
            source: 'loop' as const,
            sourceId: step.id,
            outputId: 'item',
          },
        },
        ...(collection?.outputs ?? []).map((output) => ({
          key: `${step.id}:${output.id}`,
          label: output.label,
          group: 'variables' as const,
          value: {
            kind: 'reference' as const,
            source: 'loop' as const,
            sourceId: step.id,
            outputId: output.id,
          },
        })),
      ];
      return (
        <>
          <div className="recipe-field recipe-field-compact">
            <label>Items to loop over</label>
            <Select
              value={step.collectionId}
              options={recipeCollectionCatalog.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              onChange={(collectionId) =>
                update((draft) => {
                  draft.collectionId = collectionId;
                })
              }
            />
          </div>
          {(step.collectionId === 'alts' || step.collectionId === 'bots') && (
            <div className="recipe-loop-options">
              <label>
                <Switch
                  size="small"
                  checked={step.usePluginFilters !== false}
                  onChange={(usePluginFilters) =>
                    update(
                      (draft) =>
                        void (draft.usePluginFilters = usePluginFilters),
                    )
                  }
                />
                Apply plugin account filters
              </label>
              <label>
                <Switch
                  size="small"
                  checked={Boolean(step.showProgress)}
                  onChange={(showProgress) =>
                    update((draft) => void (draft.showProgress = showProgress))
                  }
                />
                Show progress
              </label>
              <label>
                <Switch
                  size="small"
                  checked={step.showControls !== false}
                  onChange={(showControls) =>
                    update((draft) => void (draft.showControls = showControls))
                  }
                />
                Show pause, skip and previous controls
              </label>
            </div>
          )}
          {nested(
            `For every item in ${collection?.name ?? 'the collection'}`,
            step.steps,
            [...path, { stepId: step.id, slot: 'steps' }],
            step.collectionId === 'bots'
              ? appendScope(loopScope, botPropertyScope())
              : loopScope,
          )}
        </>
      );
    }
    if (step.kind === 'parallel') {
      return (
        <>
          {step.branches.map((branch) =>
            nested(branch.name, branch.steps, [
              ...path,
              { stepId: step.id, slot: 'branch', branchId: branch.id },
            ]),
          )}
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            onClick={() =>
              update((draft) => {
                draft.branches.push({
                  id: createRecipeId('branch'),
                  name: `Branch ${draft.branches.length + 1}`,
                  steps: [],
                });
              })
            }
          >
            Add another branch
          </Button>
        </>
      );
    }
    if (step.kind === 'remember') {
      return (
        <div className="recipe-two-column-fields">
          <div className="recipe-field">
            <label>Friendly name</label>
            <DeferredRecipeInput
              value={step.name}
              onCommit={(name) =>
                update((draft) => {
                  draft.name = name;
                })
              }
            />
          </div>
          <div className="recipe-field">
            <label>Value to remember</label>
            <RecipeValueEditor
              value={step.value}
              scope={scope}
              onChange={(value) =>
                update((draft) => {
                  draft.value = value;
                })
              }
            />
          </div>
        </div>
      );
    }
    if (step.kind === 'callRecipe') {
      const called = props.document.recipes.find(
        (item) => item.id === step.recipeId,
      );
      return (
        <>
          <div className="recipe-field">
            <label>Recipe</label>
            <Select
              value={step.recipeId || undefined}
              placeholder="Choose a recipe"
              options={[
                {
                  label: 'Reusable recipes',
                  options: props.document.recipes
                    .filter((item) => item.role === 'callable')
                    .map((item) => ({ value: item.id, label: item.name })),
                },
                {
                  label: 'Events',
                  options: props.document.recipes
                    .filter((item) => item.role === 'event')
                    .map((item) => ({
                      value: item.id,
                      label: `${item.name} · ${item.enabled ? 'listening' : 'off'}`,
                    })),
                },
              ].filter((group) => group.options.length)}
              onChange={(recipeId) =>
                update((draft) => {
                  draft.recipeId = recipeId;
                  draft.inputs = {};
                })
              }
            />
            {called?.role === 'event' && (
              <Typography.Text type="secondary">
                Enables this event for all current and future bots. Calling it
                again while it is listening has no effect.
              </Typography.Text>
            )}
            {called?.role === 'callable' &&
              props.botEffects.get(called.id)?.providesBot && (
                <Typography.Text type="secondary">
                  This function provides its connected bot to the following
                  steps.
                </Typography.Text>
              )}
          </div>
          {(called?.inputs ?? []).map((input) => (
            <div className="recipe-field" key={input.id}>
              <label>{input.name}</label>
              <RecipeValueEditor
                value={
                  step.inputs[input.id] ?? input.defaultValue ?? literal('')
                }
                type={input.type}
                scope={scope}
                onChange={(value) =>
                  update((draft) => {
                    draft.inputs[input.id] = value;
                  })
                }
              />
            </div>
          ))}
        </>
      );
    }
    if (step.kind === 'waitForEvent') {
      const event = getRecipeEvent(step.eventId);
      return (
        <div className="recipe-field">
          <label>Wait until</label>
          <Select
            value={step.eventId}
            options={recipeEventCatalog.map((item) => ({
              value: item.id,
              label: item.name.replace(/^When /, ''),
            }))}
            onChange={(eventId) =>
              update((draft) => {
                draft.eventId = eventId;
              })
            }
          />
          <Typography.Text type="secondary">
            {event?.outputs.length
              ? `Then use ${event.outputs.map((output) => output.label).join(', ')} in later steps.`
              : 'Then continue with the next step.'}
          </Typography.Text>
        </div>
      );
    }
    if (step.kind === 'developerCode')
      return (
        <DeferredRecipeTextArea
          rows={8}
          value={step.code}
          onCommit={(code) =>
            update((draft) => {
              draft.code = code;
            })
          }
        />
      );
    if (step.kind === 'return')
      return (
        <Typography.Text type="secondary">
          {recipe.role === 'event'
            ? 'Stops this event recipe and removes its listeners.'
            : 'Finishes this recipe and continues its caller.'}
        </Typography.Text>
      );
    return (
      <Typography.Text type="secondary">
        The plugin will stop here.
      </Typography.Text>
    );
  })();

  return (
    <article
      ref={sortable.setNodeRef}
      style={style}
      className={`recipe-step-card ${categoryClass} ${props.activeStepId === step.id ? 'active' : ''} ${props.errorStepId === step.id ? 'error' : ''}`}
      data-step-id={step.id}
    >
      <div
        className="recipe-step-header"
        onClick={() => setExpanded((current) => !current)}
      >
        {!readOnly && (
          <button
            type="button"
            className="recipe-drag-handle"
            aria-label={`Move ${getStepTitle(step)}`}
            onClick={(event) => event.stopPropagation()}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <HolderOutlined />
          </button>
        )}
        <button
          type="button"
          className="recipe-expand-button"
          aria-label={expanded ? 'Collapse action' : 'Expand action'}
        >
          {expanded ? <DownOutlined /> : <RightOutlined />}
        </button>
        <div className="recipe-step-title">
          <strong>{getStepTitle(step)}</strong>
          {!expanded && action?.description && (
            <small>{action.description}</small>
          )}
        </div>
        {step.disabled && <Tag>Disabled</Tag>}
        {!readOnly && (
          <>
            <Button
              type="text"
              size="small"
              aria-label="Duplicate action"
              icon={<CopyOutlined />}
              onClick={(event) => {
                event.stopPropagation();
                props.onCopy(step.id);
              }}
            />
            <Button
              type="text"
              danger
              size="small"
              aria-label="Delete action"
              icon={<DeleteOutlined />}
              onClick={(event) => {
                event.stopPropagation();
                props.onDelete(step.id);
              }}
            />
          </>
        )}
      </div>
      {expanded && <div className="recipe-step-body">{body}</div>}
    </article>
  );
};

export const StepList: React.FC<StepListProps> = (props) => {
  let runningScope = [...props.scope];
  const cards = props.steps.map((step, index) => {
    const card = (
      <StepCard
        key={step.id}
        {...props}
        step={step}
        index={index}
        scope={runningScope}
      />
    );
    if (!step.disabled) {
      runningScope = appendScope(
        runningScope,
        stepOutputScope(step, props.document),
      );
      if (stepProvidesBot(step, props.botEffects))
        runningScope = appendScope(runningScope, botPropertyScope());
    }
    return card;
  });

  return (
    <SortableContext
      items={props.steps.map((step) => step.id)}
      strategy={verticalListSortingStrategy}
    >
      {props.steps.length === 0 ? (
        <InsertionPoint
          target={{ recipeId: props.recipe.id, path: props.path, index: 0 }}
          selected={props.selectedTarget}
          empty
          readOnly={props.readOnly}
          onTarget={props.onTarget}
          onQuickAdd={props.onQuickAdd}
        />
      ) : (
        cards.map((card, index) => (
          <React.Fragment key={props.steps[index].id}>
            <InsertionPoint
              target={{ recipeId: props.recipe.id, path: props.path, index }}
              selected={props.selectedTarget}
              readOnly={props.readOnly}
              onTarget={props.onTarget}
              onQuickAdd={props.onQuickAdd}
            />
            {card}
          </React.Fragment>
        ))
      )}
      {props.steps.length > 0 && (
        <InsertionPoint
          target={{
            recipeId: props.recipe.id,
            path: props.path,
            index: props.steps.length,
          }}
          selected={props.selectedTarget}
          readOnly={props.readOnly}
          onTarget={props.onTarget}
          onQuickAdd={props.onQuickAdd}
        />
      )}
    </SortableContext>
  );
};

export default StepList;
