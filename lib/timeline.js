// 单个版本的时间上下文：哪些场次已经演过、哪些还没到。
//
// 只按场次单给出的顺序推演，不按剧情常识补全。
// excludeSegments 用于排练中删除的场次：删掉后不再进入时间线。

import { editionSegments } from './shows.js';

export function editionOrder(programs, edition, stageDirections = [], excludeSegments = []) {
  const excluded = new Set(excludeSegments);
  return editionSegments(programs, edition, stageDirections)
    .filter(segment => !excluded.has(segment));
}
