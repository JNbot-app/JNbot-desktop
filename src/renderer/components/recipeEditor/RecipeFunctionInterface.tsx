import { DeleteOutlined } from '@ant-design/icons';
import { Button, Card, Select, Typography } from 'antd';
import React from 'react';
import {
  literal,
  type RecipeDefinitionV3,
  type RecipeParameter,
} from '../../../common/recipeV3';
import RecipeValueEditor from './RecipeValueEditor';
import DeferredRecipeInput from './DeferredRecipeInput';
import type { ScopeValue } from './recipeEditorUtils';

const valueTypes = [
  'string',
  'number',
  'boolean',
  'list',
  'object',
  'any',
] as const;

const RecipeFunctionInterface: React.FC<{
  recipe: RecipeDefinitionV3;
  scope: ScopeValue[];
  readOnly: boolean;
  onAdd: (kind: 'inputs' | 'outputs') => void;
  onUpdate: (
    kind: 'inputs' | 'outputs',
    id: string,
    update: (parameter: RecipeParameter) => void,
  ) => void;
  onRemove: (kind: 'inputs' | 'outputs', id: string) => void;
}> = ({ recipe, scope, readOnly, onAdd, onUpdate, onRemove }) => (
  <Card
    className="recipe-interface"
    title="Function inputs and returned values"
    variant="borderless"
  >
    <div className="recipe-interface-section">
      <div className="recipe-interface-heading">
        <div>
          <strong>Inputs</strong>
          <Typography.Text type="secondary">
            Values this function receives when called.
          </Typography.Text>
        </div>
        {!readOnly && (
          <Button size="small" onClick={() => onAdd('inputs')}>
            Add input
          </Button>
        )}
      </div>
      {(recipe.inputs ?? []).length === 0 && (
        <Typography.Text type="secondary">No inputs.</Typography.Text>
      )}
      {(recipe.inputs ?? []).map((input) => (
        <div className="recipe-parameter" key={input.id}>
          <div className="recipe-parameter-row">
            <DeferredRecipeInput
              disabled={readOnly}
              aria-label="Input name"
              value={input.name}
              onCommit={(name) =>
                onUpdate('inputs', input.id, (item) => {
                  item.name = name;
                })
              }
            />
            <Select
              disabled={readOnly}
              aria-label="Input type"
              value={input.type}
              options={valueTypes.map((value) => ({ value, label: value }))}
              onChange={(type) =>
                onUpdate('inputs', input.id, (item) => {
                  item.type = type;
                })
              }
            />
            {!readOnly && (
              <Button
                type="text"
                danger
                aria-label="Delete input"
                icon={<DeleteOutlined />}
                onClick={() => onRemove('inputs', input.id)}
              />
            )}
          </div>
        </div>
      ))}
    </div>
    <div className="recipe-interface-section">
      <div className="recipe-interface-heading">
        <div>
          <strong>Returned values</strong>
          <Typography.Text type="secondary">
            Results available after this function finishes.
          </Typography.Text>
        </div>
        {!readOnly && (
          <Button size="small" onClick={() => onAdd('outputs')}>
            Add returned value
          </Button>
        )}
      </div>
      {(recipe.outputs ?? []).length === 0 && (
        <Typography.Text type="secondary">
          This function does not return a value.
        </Typography.Text>
      )}
      {(recipe.outputs ?? []).map((output) => (
        <div className="recipe-parameter" key={output.id}>
          <div className="recipe-parameter-row">
            <DeferredRecipeInput
              disabled={readOnly}
              aria-label="Returned value name"
              value={output.name}
              onCommit={(name) =>
                onUpdate('outputs', output.id, (item) => {
                  item.name = name;
                })
              }
            />
            <Select
              disabled={readOnly}
              aria-label="Returned value type"
              value={output.type}
              options={valueTypes.map((value) => ({ value, label: value }))}
              onChange={(type) =>
                onUpdate('outputs', output.id, (item) => {
                  item.type = type;
                })
              }
            />
            {!readOnly && (
              <Button
                type="text"
                danger
                aria-label="Delete returned value"
                icon={<DeleteOutlined />}
                onClick={() => onRemove('outputs', output.id)}
              />
            )}
          </div>
          <label>Value returned</label>
          <RecipeValueEditor
            value={output.defaultValue ?? literal('')}
            type={output.type}
            scope={scope}
            onChange={(value) =>
              onUpdate('outputs', output.id, (item) => {
                item.defaultValue = value;
              })
            }
          />
        </div>
      ))}
    </div>
  </Card>
);

export default RecipeFunctionInterface;
