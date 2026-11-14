import React from 'react';
import { ApiOutlined } from '@ant-design/icons';
import { RiOpenaiFill } from 'react-icons/ri';
import { SiClaude, SiCursor, SiGooglegemini, SiPerplexity, SiWindsurf } from 'react-icons/si';
import { VscVscode } from 'react-icons/vsc';

type Brand = { match: RegExp; icon: React.ReactNode; color?: string };

// Brand logos keep their official color; unknown clients fall back to a generic icon.
const brands: Brand[] = [
  { match: /claude|anthropic/i, icon: <SiClaude />, color: '#D97757' },
  { match: /chatgpt|openai|codex/i, icon: <RiOpenaiFill /> },
  { match: /cursor/i, icon: <SiCursor /> },
  { match: /gemini/i, icon: <SiGooglegemini />, color: '#4285F4' },
  { match: /windsurf/i, icon: <SiWindsurf /> },
  { match: /perplexity/i, icon: <SiPerplexity />, color: '#20B8CD' },
  { match: /vs ?code|copilot/i, icon: <VscVscode />, color: '#007ACC' },
];

export const getClientBrand = (name: string): { icon: React.ReactNode; color?: string } =>
  brands.find(({ match }) => match.test(name)) ?? { icon: <ApiOutlined /> };
