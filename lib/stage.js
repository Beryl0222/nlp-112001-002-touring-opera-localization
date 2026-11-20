// 把中文场记切分成可引用的来源片段，并标出片段语气。
//
// 语气只作提示：对白、唱词、动作、叙述、编辑补充都可能混在同一行里。
// 这里给出的是范围（记录号 + 字符下标）与语气标签，编辑仍应回到原文核对。

import {
  EDITORIAL_MARKERS,
  LYRIC_MARKERS,
  NARRATION_MARKERS,
  STAGE_ACTION_MARKERS
} from './lexicon.js';
import { splitClauses } from './text.js';

const QUOTE_PATTERNS = [
  /[“「『]([^”」』]+)[”」』]/gu,
  /(?<=^|[\s，。；：、])["']([^"']+)["']/gu
];

function stripLead(text) {
  return text.replace(/^[\s，,、：:。；;]+/u, '');
}

function quotedRanges(row) {
  const ranges = [];
  for (const source of QUOTE_PATTERNS) {
    const regex = new RegExp(source.source, source.flags);
    for (const match of row.text.matchAll(regex)) {
      const start = match.index + match[0].indexOf(match[1]);
      ranges.push({ start, end: start + match[1].length });
    }
  }
  return ranges;
}

function inside(ranges, index) {
  return ranges.some(range => index >= range.start && index < range.end);
}

/**
 * 语气判断顺序：编辑补充与舞台说明最具体，先认；唱词、叙述次之；
 * 都认不出时按台词处理（场记以人物念白为主），而不是强行归为“说明”。
 */
function classify(clauseText, { inQuote }) {
  const text = stripLead(clauseText);
  const tags = [];
  if (inQuote) tags.push('dialogue');
  if (LYRIC_MARKERS.test(text) || /(?:^|，)唱/u.test(clauseText)) tags.push('lyric');
  if (EDITORIAL_MARKERS.test(text)) tags.push('editorial-note');
  if (STAGE_ACTION_MARKERS.test(text)) tags.push('stage-action');
  if (NARRATION_MARKERS.test(text)) tags.push('narration');
  if (!tags.length) {
    tags.push(inQuote ? 'dialogue' : 'dialogue');
  }
  return [...new Set(tags)];
}

/**
 * 返回场记行的来源片段。
 * 每个片段含绝对 start/end（可用于 text.slice）与所属行 id。
 */
export function annotateStageDirection(row) {
  const quotes = quotedRanges(row);
  const clauses = splitClauses(row.text);
  const fragments = clauses.map(clause => {
    const tags = classify(clause.text, { inQuote: inside(quotes, clause.start) });
    return {
      stageId: row.id,
      edition: row.edition,
      segment: row.segment,
      role: row.role,
      language: row.language,
      start: clause.start,
      end: clause.end,
      text: clause.text,
      tags
    };
  });

  const sentences = [];
  let cursor = 0;
  for (const sentence of row.text.split(/(?<=[。！？；])/u)) {
    if (!sentence) continue;
    const start = row.text.indexOf(sentence, cursor);
    cursor = start + sentence.length;
    sentences.push({
      stageId: row.id,
      start,
      end: start + sentence.length,
      text: sentence,
      tags: [...new Set(fragments
        .filter(fragment => fragment.start >= start && fragment.start < start + sentence.length)
        .flatMap(fragment => fragment.tags))]
    });
  }

  // 同一行既有表演事实又有编辑解释时，成段搬运容易把解释当成剧情；
  // 用 mixedTags 提示编辑回到片段级别引用。
  return {
    row,
    fragments,
    sentences,
    mixedTags: new Set(fragments.flatMap(fragment => fragment.tags)).size > 1
  };
}

export function annotateAll(stageDirections) {
  return stageDirections.map(annotateStageDirection);
}
