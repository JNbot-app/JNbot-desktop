const parseColorToRgb = (color?: string) => {
  if (!color) {
    return null;
  }

  if (color.startsWith('#')) {
    const sanitized = color.replace('#', '');
    if (sanitized.length !== 6 && sanitized.length !== 3) {
      return null;
    }

    const normalized =
      sanitized.length === 3
        ? sanitized
            .split('')
            .map((char) => `${char}${char}`)
            .join('')
        : sanitized.slice(0, 6);

    const r = Number.parseInt(normalized.slice(0, 2), 16);
    const g = Number.parseInt(normalized.slice(2, 4), 16);
    const b = Number.parseInt(normalized.slice(4, 6), 16);

    if ([r, g, b].some((channel) => Number.isNaN(channel))) {
      return null;
    }

    return [r, g, b] as const;
  }

  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) {
    return null;
  }

  const [, rStr, gStr, bStr] = match;
  const r = Number.parseInt(rStr, 10);
  const g = Number.parseInt(gStr, 10);
  const b = Number.parseInt(bStr, 10);

  if ([r, g, b].some((channel) => Number.isNaN(channel))) {
    return null;
  }

  return [r, g, b] as const;
};

export const withAlpha = (color: string, alpha: number) => {
  const rgb = parseColorToRgb(color);
  if (!rgb) {
    return color;
  }

  const [r, g, b] = rgb;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
