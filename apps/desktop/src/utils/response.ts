export const ID_COLORS = [
  "#c41a1a", "#1a8fc4", "#1aaa3e", "#b06d15", "#8c1ac4",
  "#c41a8a", "#0d8a7a", "#6b6b00", "#2d5faa", "#aa2d5f",
  "#4a7a0d", "#8a4a00", "#0d5f8a", "#7a0d5f", "#5f8a0d",
  "#aa0d2d", "#2d8aaa", "#5f0d8a", "#8a7a0d", "#0d8a3a",
];
export const idColorMap = new Map<string, string>();
export const getIdColor = (id: string): string => {
  if (!id) return "inherit";
  let color = idColorMap.get(id);
  if (!color) {
    color = ID_COLORS[idColorMap.size % ID_COLORS.length];
    idColorMap.set(id, color);
  }
  return color;
};

export const extractWatchoi = (name: string): string | null => {
  const m = name.match(/[(（]([^)）]+)[)）]\s*$/);
  if (!m) return null;
  const inner = m[1].trim();
  // Name suffix in parens with provider + space + code (e.g. "ﾜｯﾁｮｲW 0b6b-v/9N", "JP 0H7f-p4YP")
  if (/\S+\s+\S+/.test(inner)) return inner;
  return null;
};

export const extractBeNumber = (...sources: string[]): string | null => {
  const patterns = [
    /BE[:：]\s*(\d+)/i,
    /javascript\s*:\s*be\((\d+)\)/i,
    /\bbe\((\d+)\)/i,
    /[?&]i=(\d+)/i,
    /\/user\/(\d+)\b/i,
  ];
  for (const source of sources) {
    if (!source) continue;
    for (const pattern of patterns) {
      const m = source.match(pattern);
      if (m?.[1]) return m[1];
    }
  }
  return null;
};
