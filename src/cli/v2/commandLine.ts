export function commandArguments(value: string): string[] {
  const input = value.trim().replace(/^jnbot(?:\s+|$)/i, '');
  const result: string[] = [];
  let current = '';
  let quote = '';
  let escaped = false;
  for (const character of input) {
    if (escaped) { current += character; escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (quote) {
      if (character === quote) quote = '';
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (/\s/.test(character)) {
      if (current) { result.push(current); current = ''; }
    } else current += character;
  }
  if (quote) throw new Error('Close the quoted value before running the command.');
  if (escaped) current += '\\';
  if (current) result.push(current);
  return result;
}
