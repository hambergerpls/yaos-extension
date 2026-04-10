import type { CommentThread } from "./types";

export interface RangeLocation {
  from: number;
  to: number;
}

export function findRangeInDocument(
  docContent: string,
  rangeText: string,
  rangeContext: string,
  rangeOffset: number,
): RangeLocation | null {
  if (!rangeText || !docContent) return null;

  const positions: number[] = [];
  let searchFrom = 0;
  while (searchFrom < docContent.length) {
    const idx = docContent.indexOf(rangeText, searchFrom);
    if (idx === -1) break;
    positions.push(idx);
    searchFrom = idx + 1;
  }

  if (positions.length === 0) return null;

  if (positions.length === 1) {
    return { from: positions[0]!, to: positions[0]! + rangeText.length };
  }

  if (rangeContext) {
    const contextIdx = docContent.indexOf(rangeContext);
    if (contextIdx !== -1) {
      const bestMatch = positions.reduce((closest, pos) => {
        const currDist = Math.abs(pos - contextIdx);
        const closestDist = Math.abs(closest - contextIdx);
        return currDist < closestDist ? pos : closest;
      });
      return { from: bestMatch, to: bestMatch + rangeText.length };
    }
  }

  const bestMatch = positions.reduce((closest, pos) => {
    const currDist = Math.abs(pos - rangeOffset);
    const closestDist = Math.abs(closest - rangeOffset);
    return currDist < closestDist ? pos : closest;
  });

  return { from: bestMatch, to: bestMatch + rangeText.length };
}
