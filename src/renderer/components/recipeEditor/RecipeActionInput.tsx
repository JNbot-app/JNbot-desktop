import React, { useEffect, useMemo, useState } from 'react';
import type { RecipeInputDefinition } from '../../../common/recipeCatalog';
import type { RecipeValue } from '../../../common/recipeV3';
import type { MacroInfo } from '../../../main/src/types';
import { groupActionOptions } from '../../utils/actionOptions';
import { GamemodeSelect } from '../general/scriptSettings/SettingOptions/GamemodeSelectOption';
import RecipeValueEditor from './RecipeValueEditor';
import type { ScopeValue } from './recipeEditorUtils';

let actionCache: MacroInfo[] | undefined;
let actionRequest: Promise<MacroInfo[]> | undefined;

const loadActions = () => {
  if (actionCache) return Promise.resolve(actionCache);
  actionRequest ??= window.ipcRenderer
    .get<MacroInfo[]>('GET_SCRIPT_ACTIONS')
    .then((actions) => (actionCache = actions));
  return actionRequest;
};

const RecipeActionInput: React.FC<{
  definition: RecipeInputDefinition;
  value: RecipeValue;
  scope: ScopeValue[];
  onChange: (value: RecipeValue) => void;
}> = React.memo(({ definition, value, scope, onChange }) => {
  const [actions, setActions] = useState<MacroInfo[] | undefined>(actionCache);

  useEffect(() => {
    if (definition.control !== 'scriptAction' || actions) return;
    let active = true;
    void loadActions().then((next) => {
      if (active) setActions(next);
    });
    return () => {
      active = false;
    };
  }, [actions, definition.control]);

  const choices = useMemo(() => {
    if (definition.control === 'scriptAction')
      return groupActionOptions(
        (actions ?? []).filter((action) => action.language === 'js'),
      );
    return definition.choices;
  }, [actions, definition.choices, definition.control]);

  return (
    <RecipeValueEditor
      value={value}
      type={definition.type}
      choices={choices}
      loading={definition.control === 'scriptAction' && !actions}
      placeholder={definition.placeholder}
      scope={scope}
      renderLiteralInput={
        definition.control === 'gamemode'
          ? (current, setCurrent) => (
              <GamemodeSelect
                value={
                  current === null || current === ''
                    ? undefined
                    : String(current)
                }
                placeholder="Select a gamemode"
                onChange={setCurrent}
              />
            )
          : undefined
      }
      onChange={onChange}
    />
  );
});

export default RecipeActionInput;
