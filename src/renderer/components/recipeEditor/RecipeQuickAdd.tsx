import { SearchOutlined } from '@ant-design/icons';
import { Empty, Input, InputRef, List, Modal, Tag, Typography } from 'antd';
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { recipeActionCatalog } from '../../../common/recipeCatalog';
import type { RecipeDocumentV3 } from '../../../common/recipeV3';
import {
  canInsertLibraryItem,
  logicLibraryItems,
  type InsertTarget,
} from './recipeEditorUtils';

type QuickItem = {
  type: 'action' | 'logic';
  id: string;
  name: string;
  description: string;
  category: string;
};

const RecipeQuickAdd: React.FC<{
  open: boolean;
  document: RecipeDocumentV3;
  target: InsertTarget;
  onClose: () => void;
  onInsert: (type: 'action' | 'logic', id: string) => void;
}> = ({ open, document, target, onClose, onInsert }) => {
  const [query, setQuery] = useState('');
  const inputRef = React.useRef<InputRef>(null);
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const items = useMemo(() => {
    const hasCallable = document.recipes.some(
      (recipe) => recipe.role !== 'onRun',
    );
    const all: QuickItem[] = [
      ...recipeActionCatalog.map((action) => ({
        type: 'action' as const,
        id: action.id,
        name: action.name,
        description: action.description,
        category: action.category,
      })),
      ...logicLibraryItems
        .filter((item) => item.id !== 'callRecipe' || hasCallable)
        .map((item) => ({
          type: 'logic' as const,
          id: item.id,
          name: item.name,
          description: item.description,
          category: 'Logic',
        })),
    ];
    const normalized = query.trim().toLowerCase();
    return all.filter(
      (item) =>
        canInsertLibraryItem(document, target, item.type, item.id) &&
        `${item.name} ${item.description} ${item.category}`
          .toLowerCase()
          .includes(normalized),
    );
  }, [document, query, target]);

  const choose = (item: QuickItem | undefined) => {
    if (!item) return;
    onInsert(item.type, item.id);
    onClose();
  };

  useLayoutEffect(() => {
    if (!open) return;
    setTimeout(() => {
      inputRef.current?.focus({ cursor: 'end' });
    }, 100)
  }, [open]);

  return (
    <Modal
      open={open}
      title="Add next step"
      footer={null}
      width={520}
      destroyOnHidden
      onCancel={onClose}
    >
      <Input
        autoFocus
        allowClear
        ref={inputRef}
        prefix={<SearchOutlined />}
        placeholder="Type an action name and press Enter"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onPressEnter={() => choose(items[0])}
      />
      <List
        className="recipe-quick-list"
        dataSource={items.slice(0, 12)}
        locale={{ emptyText: <Empty description="No matching steps" /> }}
        renderItem={(item) => (
          <List.Item onClick={() => choose(item)}>
            <List.Item.Meta
              title={
                <span>
                  {item.name} <Tag>{item.category}</Tag>
                </span>
              }
              description={
                <Typography.Text type="secondary">
                  {item.description}
                </Typography.Text>
              }
            />
          </List.Item>
        )}
      />
    </Modal>
  );
};

export default RecipeQuickAdd;
