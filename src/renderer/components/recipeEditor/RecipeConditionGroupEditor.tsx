import { PlusOutlined } from '@ant-design/icons';
import { Button, Segmented, Typography } from 'antd';
import React from 'react';
import type { RecipeCondition } from '../../../common/recipeV3';
import RecipeConditionEditor from './RecipeConditionEditor';
import { createCondition, type ScopeValue } from './recipeEditorUtils';

type ConditionGroup = {
  match: 'all' | 'any';
  conditions: RecipeCondition[];
};

const RecipeConditionGroupEditor: React.FC<{
  group: ConditionGroup;
  scope: ScopeValue[];
  title: string;
  onChange: (update: (group: ConditionGroup) => void) => void;
}> = React.memo(({ group, scope, title, onChange }) => (
  <section className="recipe-condition-group">
    <div className="recipe-condition-group-header">
      <div>
        <Typography.Text strong>{title}</Typography.Text>
        <Typography.Text type="secondary">
          {group.match === 'all'
            ? 'Every condition must match.'
            : 'At least one condition must match.'}
        </Typography.Text>
      </div>
      <Segmented
        size="small"
        value={group.match}
        options={[
          { value: 'all', label: 'All conditions' },
          { value: 'any', label: 'Any condition' },
        ]}
        onChange={(match) =>
          onChange((draft) => void (draft.match = match as 'all' | 'any'))
        }
      />
    </div>
    <div className="recipe-condition-list">
      {group.conditions.map((condition, index) => (
        <RecipeConditionEditor
          key={condition.id ?? index}
          condition={condition}
          label={`Condition ${index + 1}`}
          scope={scope}
          onChange={(change) =>
            onChange((draft) => change(draft.conditions[index]))
          }
          onRemove={
            group.conditions.length > 1
              ? () =>
                  onChange((draft) => void draft.conditions.splice(index, 1))
              : undefined
          }
        />
      ))}
    </div>
    <Button
      block
      type="text"
      size="small"
      className="recipe-condition-add"
      icon={<PlusOutlined />}
      onClick={() =>
        onChange((draft) => void draft.conditions.push(createCondition()))
      }
    >
      Add another condition
    </Button>
  </section>
));

export default RecipeConditionGroupEditor;
