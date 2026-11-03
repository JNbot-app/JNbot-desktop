function isCodeObject(value: unknown): value is { code: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string'
  );
}

export function codeEditorValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  return isCodeObject(value) ? value.code : null;
}
