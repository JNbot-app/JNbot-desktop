import { useDraggable } from '@dnd-kit/core';
import {
  CodeOutlined,
  HolderOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { Input, Typography } from 'antd';
import React from 'react';
import {
  recipeActionCatalog,
  type RecipeActionDefinition,
} from '../../../common/recipeCatalog';
import type { RecipeDocumentV3 } from '../../../common/recipeV3';
import {
  logicLibraryItems,
  canInsertLibraryItem,
  type InsertTarget,
  type RecipeDragData,
} from './recipeEditorUtils';

const DraggableLibraryItem: React.FC<{
  itemType: 'action' | 'logic';
  itemId: string;
  name: string;
  description: string;
  category?: string;
  onInsert: () => void;
}> = ({ itemType, itemId, name, description, category, onInsert }) => {
  const dragId = `library:${itemType}:${itemId}`;
  const draggable = useDraggable({
    id: dragId,
    data: {
      type: 'library',
      itemType,
      itemId,
      label: name,
    } satisfies RecipeDragData,
  });
  return (
    <button
      ref={draggable.setNodeRef}
      type="button"
      className={`recipe-library-action ${category ? `action-${category.toLowerCase()}` : 'action-logic'}`}
      style={{ opacity: draggable.isDragging ? 0.35 : undefined }}
      onClick={onInsert}
      {...draggable.attributes}
      {...draggable.listeners}
    >
      <HolderOutlined className="recipe-library-drag-icon" />
      <span>
        <strong>{name}</strong>
        <small>{description}</small>
      </span>
    </button>
  );
};

export const RecipeActionLibrary: React.FC<{
  document: RecipeDocumentV3;
  target: InsertTarget;
  onInsert: (itemType: 'action' | 'logic', itemId: string) => void;
}> = ({ document, target, onInsert }) => {
  const [search, setSearch] = React.useState('');
  const query = search.trim().toLowerCase();
  const actions = recipeActionCatalog.filter(
    (action) =>
      canInsertLibraryItem(document, target, 'action', action.id) &&
      `${action.name} ${action.description} ${action.category}`
        .toLowerCase()
        .includes(query),
  );
  const visibleLogic = logicLibraryItems.filter(
    (item) =>
      (item.id !== 'callRecipe' ||
        document.recipes.some((recipe) => recipe.role !== 'onRun')) &&
      canInsertLibraryItem(document, target, 'logic', item.id) &&
      `${item.name} ${item.description}`.toLowerCase().includes(query),
  );
  const targetRecipe = document.recipes.find(
    (recipe) => recipe.id === target.recipeId,
  );
  const targetSection = target.path[target.path.length - 1]?.slot;
  const targetSectionLabel =
    targetSection === 'then'
      ? 'Then'
      : targetSection === 'otherwise'
        ? 'Otherwise'
        : targetSection === 'branch'
          ? 'Run together branch'
          : targetSection === 'steps'
            ? 'Loop'
            : targetRecipe?.name ?? 'Recipe';

  const section = (category: RecipeActionDefinition['category']) => {
    const categoryActions = actions.filter(
      (action) => action.category === category,
    );
    if (!categoryActions.length) return null;
    return (
      <section className="recipe-library-section" key={category}>
        <Typography.Text
          type="secondary"
          className="recipe-library-section-title"
        >
          {category}
        </Typography.Text>
        {categoryActions.map((action) => (
          <DraggableLibraryItem
            key={action.id}
            itemType="action"
            itemId={action.id}
            name={action.name}
            description={action.description}
            category={action.category}
            onInsert={() => onInsert('action', action.id)}
          />
        ))}
      </section>
    );
  };

  return (
    <aside className="recipe-library">
      <div className="recipe-library-heading">
        <div>
          <strong>Actions</strong>
          <Typography.Text type="secondary">
            Drag into the workflow or click to insert at the selected line.
          </Typography.Text>
        </div>
      </div>
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="Search actions"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="recipe-library-target">
        Selected: {targetSectionLabel} · position {target.index + 1}
      </div>
      {(['Bot', 'Timing', 'Data', 'Other'] as const).map(section)}
      {!!visibleLogic.length && (
        <section className="recipe-library-section">
          <Typography.Text
            type="secondary"
            className="recipe-library-section-title"
          >
            Logic and data
          </Typography.Text>
          {visibleLogic.map((item) => (
            <DraggableLibraryItem
              key={item.id}
              itemType="logic"
              itemId={item.id}
              name={item.name}
              description={item.description}
              onInsert={() => onInsert('logic', item.id)}
            />
          ))}
        </section>
      )}
        {'javascript developer code'.includes(query) && (
          <section className="recipe-library-section">
            <Typography.Text
              type="secondary"
              className="recipe-library-section-title"
            >
              Developer
            </Typography.Text>
            <DraggableLibraryItem
              itemType="logic"
              itemId="developerCode"
              name="JavaScript"
              description="Runs custom code and changes the plugin trust level."
              category="Developer"
              onInsert={() => onInsert('logic', 'developerCode')}
            />
            <CodeOutlined className="recipe-library-code-badge" />
          </section>)}
    </aside>
  );
};

export default RecipeActionLibrary;
