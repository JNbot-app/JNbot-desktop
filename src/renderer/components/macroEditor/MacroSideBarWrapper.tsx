import React, { useEffect, useState } from 'react';
import { Button, Layout, Result, Spin } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import useAppApi from '../../hooks/useAppApi';
import { MacroInfo } from '../macros/types';
import RecipeEditor from '../recipeEditor/RecipeEditor';
import {
  isRecipeDocument,
  type RecipeDocumentV3,
} from '../../../common/recipeV3';
import {
  convertLegacyCanvas,
  type LegacyCanvasLike,
} from '../../../common/legacyRecipeConverter';

const MacroSidebarWrapper: React.FC = () => {
  const navigate = useNavigate();
  const [components, setComponents] = useState<RecipeDocumentV3 | null>(null);
  const [legacyReasons, setLegacyReasons] = useState<string[]>([]);
  const params = useParams();
  const { snackbar } = useAppApi();
  const [macroInfo, setMacroInfo] = useState<MacroInfo>();

  useEffect(() => {
    if (!params.id) return console.error('No plugin id found');

    window.ipcRenderer.get<any>('MACRO_CODE', params.id).then((data) => {
      if (data.status === 'error' || !data.code) {
        navigate(-1);
        console.log('error', data.error);
        return;
      }
      if (isRecipeDocument(data.code)) {
        setComponents(data.code);
        setMacroInfo(data.info);
        return;
      }
      if (!('nodes' in data.code) || !('edges' in data.code)) {
        console.error(
          "You're either using old plugin version or you're trying an invalid plugin",
        );
        snackbar.error({
          message: 'No longer support for outdated plugin, make a new plugin',
        });
        navigate(-1);
        return;
      }
      const conversion = convertLegacyCanvas(data.code as LegacyCanvasLike);
      if (conversion.ok === true) {
        setComponents(conversion.document);
        window.ipcRenderer
          .get('MIGRATE_MACRO_TO_RECIPE', {
            pluginId: params.id,
            recipe: conversion.document,
          })
          .then((result: any) => {
            if (result?.status === 'error') {
              snackbar.error({
                message: result.message || 'Could not save recipe migration',
              });
            }
          });
      } else {
        setLegacyReasons(conversion.reasons);
      }
      setMacroInfo(data.info);
    });
  }, [params.id, navigate, snackbar]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {components && macroInfo ? (
        <RecipeEditor
          document={components}
          pluginInfo={macroInfo}
          pluginId={params.id!}
        />
      ) : legacyReasons.length ? (
        <Result
          status="warning"
          title="This old canvas plugin cannot be converted"
          subTitle={legacyReasons.join(' ')}
          extra={<Button onClick={() => navigate(-1)}>Back to plugins</Button>}
        />
      ) : (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100vw',
            width: '100vw',
          }}
        >
          <Spin size="large" />
        </div>
      )}
    </Layout>
  );
};

export default MacroSidebarWrapper;
