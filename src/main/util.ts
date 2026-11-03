/* eslint import/prefer-default-export: off, import/no-mutable-exports: off */
import { shell } from 'electron';
import { URL } from 'url';
import path from 'path';

/** True for http(s) URLs, the only schemes safe to hand to the OS or a window. */
export const isWebUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

/** Open an http(s) URL in the user's browser; other schemes are refused. */
export const openWebUrl = async (url: string): Promise<boolean> => {
  if (!isWebUrl(url)) {
    console.warn('Refusing to open non-http(s) URL', url);
    return false;
  }
  // openExternal rejects on Windows when ShellExecute fails; never let that
  // reach the global unhandledRejection handler.
  try {
    await shell.openExternal(url);
    return true;
  } catch (err) {
    console.error('Error opening URL', url, err);
    return false;
  }
};

export let resolveHtmlPath: (
  htmlFileName: string,
  absolutePath?: boolean,
  subDir?: string,
) => string;

resolveHtmlPath = (
  htmlFileName: string,
  absolutePath: boolean = false,
  subDir: string = '',
) => {
  if (process.env.NODE_ENV === 'development' && !absolutePath) {
    const port = process.env.PORT || 1212;
    const url = new URL(
      `http://localhost:${port}${subDir ? `/${subDir}` : ''}`,
    );
    url.pathname = htmlFileName;
    if (subDir?.length) url.searchParams.append('redirect', '/' + subDir);
    return url.href;
  } else {
    const a = `file://${path.resolve(__dirname, '../renderer/', htmlFileName)}`;

    if (subDir) {
      const url = new URL(a);
      url.searchParams.append('redirect', '/' + subDir);
      return url.href;
    } else {
      return a;
    }
  }
};

// if (process.env.NODE_ENV === 'development' ) {
//   const port = process.env.PORT || 1212;
//   resolveHtmlPath = (htmlFileName: string) => {
//     const url = new URL(`http://localhost:${port}`);
//     url.pathname = htmlFileName;
//     return url.href;
//   };
// } else {
//   resolveHtmlPath = (htmlFileName: string) => {
//     return `file://${path.resolve(__dirname, '../renderer/', htmlFileName)}`;
//   };
// }
