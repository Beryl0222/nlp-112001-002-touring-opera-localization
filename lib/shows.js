// 场次单：把每个“版本 + 介质”的演出拆成有序场次与字数上限。

import { parseList } from './text.js';

export function buildPrograms(programRows) {
  return programRows.map(row => {
    const orderedSegments = parseList(row.orderedSegments);
    const maxCharacters = Number.parseInt(row.maxCharacters, 10);
    return {
      id: row.id,
      edition: row.edition,
      medium: row.medium,
      orderedSegments,
      maxCharacters: Number.isFinite(maxCharacters) ? maxCharacters : null,
      rawMaxCharacters: row.maxCharacters,
      warnings: Number.isFinite(maxCharacters)
        ? []
        : [`maxCharacters 不是整数：${row.maxCharacters}`]
    };
  });
}

/**
 * 为一条改稿找到候选演出。
 * 只凭 medium 与 segment 匹配；若命中多个不同版本，则保留全部并标记歧义。
 */
export function findPrograms(programs, { medium, segment }) {
  return programs.filter(program =>
    program.medium === medium && program.orderedSegments.includes(segment)
  );
}

/** 同一版本的所有场次（按各场次单出现顺序合并）。 */
export function editionSegments(programs, edition, stageDirections = []) {
  const ordered = [];
  const add = segment => {
    if (segment && !ordered.includes(segment)) ordered.push(segment);
  };
  for (const program of programs) {
    if (program.edition !== edition) continue;
    for (const segment of program.orderedSegments) add(segment);
  }
  for (const row of stageDirections) {
    if (row.edition === edition) add(row.segment);
  }
  return ordered;
}
