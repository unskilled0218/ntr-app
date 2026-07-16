export function lineBounds(text: string, pos: number): { start: number; end: number } {
  const clamped = Math.max(0, Math.min(pos, text.length));
  const startBreak = text.lastIndexOf("\n", Math.max(0, clamped - 1));
  const endBreak = text.indexOf("\n", clamped);
  return {
    start: startBreak === -1 ? 0 : startBreak + 1,
    end: endBreak === -1 ? text.length : endBreak,
  };
}

export function cutRange(text: string, start: number, end: number): { text: string; caret: number; copied: string } {
  const from = Math.max(0, Math.min(start, end, text.length));
  const to = Math.max(0, Math.min(Math.max(start, end), text.length));

  if (from !== to) {
    return {
      text: text.slice(0, from) + text.slice(to),
      caret: from,
      copied: text.slice(from, to),
    };
  }

  const line = lineBounds(text, from);
  const copied = text.slice(line.start, line.end) + "\n";
  if (text === "") return { text: "", caret: 0, copied };
  if (line.end < text.length) {
    return {
      text: text.slice(0, line.start) + text.slice(line.end + 1),
      caret: line.start,
      copied,
    };
  }
  if (line.start > 0) {
    return {
      text: text.slice(0, line.start - 1) + text.slice(line.end),
      caret: line.start - 1,
      copied,
    };
  }
  return { text: "", caret: 0, copied };
}
