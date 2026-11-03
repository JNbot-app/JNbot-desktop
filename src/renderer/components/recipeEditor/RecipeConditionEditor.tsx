import { DeleteOutlined } from '@ant-design/icons';
import { Button, Checkbox, Select, Typography } from 'antd';
import React from 'react';
import {
  literal,
  type RecipeComparisonOperator,
  type RecipeCondition,
} from '../../../common/recipeV3';
import RecipeValueEditor from './RecipeValueEditor';
import type { ScopeValue } from './recipeEditorUtils';

const operators: Array<{ value: RecipeComparisonOperator; label: string }> = [
  { value: 'equal', label: 'equals' },
  { value: 'notEqual', label: 'does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'notContains', label: 'does not contain' },
  { value: 'greater', label: 'is greater than' },
  { value: 'less', label: 'is less than' },
  { value: 'greaterEqual', label: 'is at least' },
  { value: 'lessEqual', label: 'is at most' },
  { value: 'true', label: 'is true' },
  { value: 'false', label: 'is false' },
  { value: 'matches', label: 'matches pattern' },
];

const RecipeConditionEditor: React.FC<{
  condition: RecipeCondition;
  scope: ScopeValue[];
  label?: string;
  onRemove?: () => void;
  onChange: (update: (condition: RecipeCondition) => void) => void;
}> = React.memo(
  ({ condition, scope, label = 'Condition', onRemove, onChange }) => (
    <div className="recipe-condition">
      <div className="recipe-condition-header">
        <Typography.Text strong>{label}</Typography.Text>
        <div className="recipe-condition-controls">
          <Checkbox
            checked={Boolean(condition.not)}
            onChange={(event) =>
              onChange((draft) => void (draft.not = event.target.checked))
            }
          >
            Not
          </Checkbox>
          {onRemove && (
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              aria-label={`Delete ${label.toLowerCase()}`}
              onClick={onRemove}
            />
          )}
        </div>
      </div>
      <div
        className={`recipe-condition-row ${['true', 'false'].includes(condition.operator) ? 'unary' : ''}`}
      >
        <div className="recipe-condition-value">
          <RecipeValueEditor
            compact
            value={condition.left}
            scope={scope}
            onChange={(left) => onChange((draft) => void (draft.left = left))}
          />
        </div>
        <Select
          value={condition.operator}
          options={operators}
          onChange={(operator) =>
            onChange((draft) => void (draft.operator = operator))
          }
        />
        {!['true', 'false'].includes(condition.operator) && (
          <div className="recipe-condition-value">
            <RecipeValueEditor
              compact
              value={condition.right ?? literal('')}
              scope={scope}
              onChange={(right) =>
                onChange((draft) => void (draft.right = right))
              }
            />
          </div>
        )}
      </div>
    </div>
  ),
);

export default RecipeConditionEditor;
