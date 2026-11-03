import type {
  AiJsonObject,
  AiPrediction,
  AiSchema,
  AiTool,
} from '../../../common/types/pluginApi';

export type ToolDefinition = Omit<AiTool, 'handler'>;
type Start = {
  requestId: string;
  deadline: number;
  text: string;
  modelUrl?: string;
  model?: 'main' | 'flash';
  reasoning?: boolean;
  toolFilterThreshold?: number | null;
};
type PredictionRequest = Start & {
  tools: ToolDefinition[];
  revision: number;
  maxNewTokens: number;
};
export type AiRequest =
  | (PredictionRequest & { kind: 'predict' })
  | (Start & { kind: 'extract'; schema: AiSchema; maxNewTokens: number })
  | (Start & { kind: 'embed' })
  | { kind: 'cancel'; requestId: string };

export type AiResponse =
  | {
      kind: 'prediction';
      prediction: AiPrediction;
    }
  | { kind: 'extraction'; value: AiJsonObject | null }
  | { kind: 'embedding'; modelId: string; values: number[] }
  | { kind: 'ended' };

export type AiOperation = (request: AiRequest) => Promise<AiResponse>;
