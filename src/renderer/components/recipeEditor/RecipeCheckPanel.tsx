import { BugOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import React from 'react';
import type { RecipeValidationIssue } from '../../../common/recipeValidation';

const RecipeCheckPanel: React.FC<{
  issues: RecipeValidationIssue[];
  onFocus: (issue: RecipeValidationIssue) => void;
}> = ({ issues, onFocus }) => (
  <div className="recipe-check-panel">
    <Typography.Title level={5}>Recipe check</Typography.Title>
    {issues.length === 0 ? (
      <Typography.Text>
        <CheckCircleOutlined /> This plugin is ready to run.
      </Typography.Text>
    ) : (
      <div className="recipe-issues">
        {issues.map((issue, index) => {
          const location = [issue.recipeName, issue.componentName]
            .filter(Boolean)
            .join(' · ');
          return (
            <button
              type="button"
              key={`${issue.recipeId}-${issue.stepId}-${index}`}
              className={`recipe-issue ${issue.severity}`}
              onClick={() => onFocus(issue)}
            >
              <BugOutlined />
              <span>
                <strong>{location || 'Plugin'}</strong>
                <small>{issue.message}</small>
              </span>
            </button>
          );
        })}
      </div>
    )}
  </div>
);

export default RecipeCheckPanel;
