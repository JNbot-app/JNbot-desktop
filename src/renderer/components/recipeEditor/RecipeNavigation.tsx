import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Dropdown, Space, Tooltip } from 'antd';
import React from 'react';
import { recipeEventCatalog } from '../../../common/recipeCatalog';
import type {
  RecipeDefinitionV3,
  RecipeDocumentV3,
} from '../../../common/recipeV3';

const roleLabel = (recipe: RecipeDefinitionV3) => {
  if (recipe.role === 'onRun') return 'Plugin start';
  if (recipe.role === 'callable') return 'Function';
  return recipe.enabled ? 'Event listener' : 'Event listener · Off';
};

const RecipeNavigation: React.FC<{
  document: RecipeDocumentV3;
  selectedId: string;
  readOnly: boolean;
  onSelect: (recipe: RecipeDefinitionV3) => void;
  onAddEvent: (eventId: string) => void;
  onAddFunction: () => void;
  onRemove: (recipeId: string) => void;
}> = ({
  document,
  selectedId,
  readOnly,
  onSelect,
  onAddEvent,
  onAddFunction,
  onRemove,
}) => (
  <aside className="recipe-sidebar">
    <div className="recipe-sidebar-heading">
      <strong>Recipes</strong>
      {!readOnly && (
        <Space size={4}>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {
                  type: 'group',
                  label: 'Event listener',
                  children: recipeEventCatalog.map((event) => ({
                    key: `event:${event.id}`,
                    label: event.name,
                  })),
                },
                { type: 'divider' },
                { key: 'function', label: 'New function' },
              ],
              onClick: ({ key }) => {
                if (key === 'function') onAddFunction();
                else if (key.startsWith('event:'))
                  onAddEvent(key.slice('event:'.length));
              },
            }}
          >
            <Tooltip title="Create an event listener or function">
              <Button size="small" icon={<PlusOutlined />} />
            </Tooltip>
          </Dropdown>
        </Space>
      )}
    </div>
    {document.recipes.map((recipe) => (
      <button
        type="button"
        key={recipe.id}
        className={`recipe-nav-item ${recipe.id === selectedId ? 'active' : ''}`}
        onClick={() => onSelect(recipe)}
      >
        <span>
          {recipe.name}
          <small>{roleLabel(recipe)}</small>
        </span>
        {!readOnly && recipe.role !== 'onRun' && (
          <Button
            icon={<DeleteOutlined />}
            type="text"
            onClick={(event) => {
              event.stopPropagation();
              onRemove(recipe.id);
            }}
          />
        )}
      </button>
    ))}
  </aside>
);

export default RecipeNavigation;
