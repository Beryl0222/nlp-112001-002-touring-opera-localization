import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { readMaterials } from '../materials.js';
import {
  copyDigest, reviewFromDirectory, reviewMaterials, summarize
} from '../lib/review.js';
import { annotateAll } from '../lib/stage.js';
import { splitClauses, splitSentences, codePointLength } from '../lib/text.js';

const tables = await readMaterials();

function reportFor(cuts = []) {
  return reviewMaterials({ tables, cuts });
}

function copyById(report, id) {
  return report.copies.find(copy => copy.copyId === id);
}

function findingCodes(copy) {
  return copy.findings.map(finding => finding.code);
}

// ---------------------------------------------------------------------------
// 文本与场记定位
// ---------------------------------------------------------------------------

test('句子切分不拆数字和常见缩写', () => {
  const spans = splitSentences('Mr. Smith rides 3.5 li. He stops.');
  assert.deepEqual(spans.map(span => span.text), [
    'Mr. Smith rides 3.5 li.',
    'He stops.'
  ]);
});

test('场记片段的字符范围可直接切回原文', () => {
  const [first] = annotateAll(tables['场记.json']);
  for (const fragment of first.fragments) {
    assert.equal(first.row.text.slice(fragment.start, fragment.end), fragment.text);
  }
  assert.deepEqual(
    first.fragments.map(fragment => fragment.tags),
    [['dialogue'], ['lyric', 'stage-action'], ['stage-action']]
  );
  // “唱末将是动作说明前的一句唱词”，不能整行当成编辑解释。
  assert.equal(first.mixedTags, true);
});

test('马鞭在院落版与溪桥版分别是动作与实物', () => {
  const report = reportFor();
  const byEdition = Object.fromEntries(
    report.polysemy.flatMap(finding => finding.sources.map(source => [source.edition, source.gloss]))
  );
  assert.equal(byEdition['院落版'], '持鞭的动作可示意骑行');
  assert.equal(byEdition['溪桥版'], '角色之间交付的实物');
});

// ---------------------------------------------------------------------------
// 改稿对照
// ---------------------------------------------------------------------------

test('亲子卡上的真马与兄弟关系分别报出并指向原文', () => {
  const copy = copyById(reportFor(), 'copy1');
  const codes = findingCodes(copy);
  assert.ok(codes.includes('literal-horse'));
  assert.ok(codes.includes('kin-vs-mentor'));
  assert.ok(codes.includes('identity-spoiler'));
  assert.ok(codes.includes('pairing-compound-arrival'));

  const horse = copy.sentences[0].traces.find(trace => trace.conceptId === 'horse');
  assert.equal(horse.status, 'sourced');
  const source = horse.sources.find(item => item.kind === 'stage');
  assert.equal(source.sourceId, 'song1');
  assert.equal(tables['场记.json'][0].text.slice(source.start, source.end), '空台没有实物马。');
  assert.equal(horse.sourceKind, 'fact');
  assert.equal(horse.negatedSource, true);

  const identity = copy.findings.find(finding => finding.code === 'identity-spoiler');
  assert.equal(identity.severity, 'blocker');
  assert.ok(identity.options.some(option => option.kind === 'defer-to-segment'));
});

test('两句各自的搭配冲突单独报出，并给出删句或改写两种选择', () => {
  const copy = copyById(reportFor(), 'copy1');
  const pairing = copy.findings.find(finding => finding.code === 'pairing-compound-arrival');
  assert.equal(pairing.severity, 'blocker');
  assert.deepEqual(pairing.sentences, [0, 1]);
  assert.ok(pairing.options.some(option => option.kind === 'drop-clause'));
  assert.ok(pairing.options.some(option => option.kind === 'rewrite-concept'));
});

test('溪桥版马鞭按实物解释，并提示“借”未译出', () => {
  const copy = copyById(reportFor(), 'copy3');
  assert.equal(copy.edition, '溪桥版');
  const whip = copy.sentences[0].traces.find(trace => trace.conceptId === 'horse-whip');
  assert.equal(whip.status, 'sourced');
  const glosses = whip.alternatives.map(item => item.sourceId);
  assert.deepEqual(glosses, ['g2']); // 不把院落版 g1 混进本版
  const drift = copy.findings.find(finding => finding.code === 'transfer-drift');
  assert.equal(drift.severity, 'info');
  assert.equal(drift.options[0].kind, 'rewrite-concept');
});

test('节目册没有相认场，改稿无法按现有场次单使用', () => {
  const copy = copyById(reportFor(), 'copy2');
  assert.ok(findingCodes(copy).includes('no-program-carries-copy'));
  // 未删段时，相认的场记仍可为这条稿作证；问题在节目单，而非出处。
  assert.equal(copy.sentences[0].verdict, 'grounded');
});

test('改稿保留剧情事实与补充说明分开列出', () => {
  const copy = copyById(reportFor(), 'copy2');
  const sentence = copy.sentences[0];
  assert.ok(sentence.retainedFacts.some(trace => trace.conceptId === 'passenger'));
  assert.ok(sentence.addedExplanations.some(trace => trace.conceptId === 'recognition'));
});

test('只提“留到下半场”不算揭晓，具体点名才算提前', () => {
  const onlyMention = {
    ...tables,
    '编辑用稿.json': [{
      id: 'mention', segment: '开场', language: 'en', medium: '亲子卡',
      text: 'The recognition scene comes later.'
    }]
  };
  const [safe] = reviewMaterials({ tables: onlyMention }).copies;
  assert.equal(safe.findings.some(finding => finding.code === 'identity-spoiler'), false);

  const spelledOut = {
    ...tables,
    '编辑用稿.json': [{
      id: 'spell', segment: '开场', language: 'en', medium: '亲子卡',
      text: 'Later the pair will recognize each other.'
    }]
  };
  const [spoiler] = reviewMaterials({ tables: spelledOut }).copies;
  const finding = spoiler.findings.find(item => item.code === 'identity-spoiler');
  assert.ok(finding);
  assert.equal(finding.severity, 'blocker');
  assert.ok(finding.options.some(option => option.kind === 'defer-to-segment'));
});

test('课堂与亲子卡对超前概念的处理不同', () => {
  const copy = {
    segment: '开场', language: 'en',
    text: 'A horse will be suggested by a whip.'
  };
  const tablesWith = medium => ({
    ...tables,
    '编辑用稿.json': [{ id: 'x', medium, ...copy }]
  });
  const family = reviewMaterials({ tables: tablesWith('亲子卡') }).copies[0];
  const classroom = reviewMaterials({ tables: tablesWith('课堂讲义') }).copies[0];
  const familyForward = family.findings.find(finding => finding.code === 'forward-concept');
  const classForward = classroom.findings.find(finding => finding.code === 'forward-concept');
  assert.equal(familyForward.severity, 'warning');
  assert.equal(classForward.severity, 'info');
  // 课堂可以先讲通用概念；讲义也不要求对上某一张节目单。
  assert.ok(classroom.audience.needsTeacherPriming.includes('horse-whip'));
  assert.equal(classroom.findings.some(finding => finding.code === 'no-program-carries-copy'), false);
  assert.ok(classroom.findings.some(finding => finding.code === 'not-in-program'));
  // 亲子卡仍须对上节目单，本场确实在 visit1 里。
  assert.equal(family.programId, 'visit1');
  assert.equal(family.findings.some(finding => finding.code === 'not-in-program'), false);
});

test('已按示意处理的说法不再当作真马报错', () => {
  const custom = {
    ...tables,
    '编辑用稿.json': [{
      id: 'ok', segment: '门口', language: 'en', medium: '亲子卡',
      text: 'The performer mimes mounting a horse; the stage is bare.'
    }]
  };
  const [copy] = reviewMaterials({ tables: custom }).copies;
  assert.equal(copy.findings.some(finding =>
    ['literal-horse', 'pairing-compound-arrival'].includes(finding.code)
  ), false);
  const horse = copy.sentences[0].traces.find(trace => trace.conceptId === 'horse');
  assert.equal(horse.framedSymbolic, true);
});

test('同一身份说法两种读法并置时提示择一', () => {
  const custom = {
    ...tables,
    '编辑用稿.json': [{
      id: 'two', segment: '相认', language: 'en', medium: '亲子卡',
      text: 'She greets her brother. An older fellow apprentice steps forward.'
    }]
  };
  const [copy] = reviewMaterials({ tables: custom }).copies;
  const finding = copy.findings.find(item => item.code === 'same-term-two-readings');
  assert.ok(finding);
  assert.equal(finding.conceptId, 'elder-brother');
  assert.ok(finding.options.some(option => option.kind === 'rewrite-concept'));
});

// ---------------------------------------------------------------------------
// 删段
// ---------------------------------------------------------------------------

test('删去门口后，依赖它的改稿与院落版马鞭一并失效', () => {
  const report = reportFor([{ edition: '院落版', segment: '门口' }]);
  const copy = copyById(report, 'copy1');
  assert.ok(findingCodes(copy).includes('copy-segment-cut'));

  const program = report.programs.find(item => item.programId === 'visit1');
  assert.deepEqual(program.segments, ['开场', '相认']);
  assert.deepEqual(program.cutSegments, ['门口']);

  const lost = report.termFindings.find(finding =>
    finding.term === '马鞭' && finding.edition === '院落版'
  );
  assert.equal(lost.code, 'term-evidence-lost');
  assert.ok(lost.message.includes('门口'));

  // 同一版本另有场次的术语仍可保留。
  const kept = report.terms.find(item => item.edition === '院落版' && item.term === '阿兄');
  assert.equal(kept.stillExplained, true);
  // 另一版本的同一术语不受影响。
  const other = report.terms.find(item => item.edition === '溪桥版' && item.term === '马鞭');
  assert.equal(other.stillExplained, true);
});

test('同版其它场次有独立证据时，删段不连坐该术语', async (context) => {
  const scratch = await mkdtemp(join(tmpdir(), 'review-'));
  context.after(() => rm(scratch, { recursive: true, force: true }));
  const directory = join(scratch, '材料');
  await mkdir(directory);
  await cp(new URL('../资料/', import.meta.url), directory, { recursive: true });

  await writeFile(join(directory, '场记.json'), JSON.stringify([
    {
      id: 'x1', edition: '院落版', segment: '门口', language: 'zh',
      role: '阿棠', text: '唱末将马鞭向远方一指。'
    },
    {
      id: 'x2', edition: '院落版', segment: '相认', language: 'zh',
      role: '阿棠', text: '再持马鞭，仍无实物。'
    },
    {
      id: 'x3', edition: '院落版', segment: '开场', language: 'zh',
      role: '主持人', text: '先看虚拟动作。'
    }
  ]));
  await writeFile(join(directory, '词义.json'), JSON.stringify([
    {
      id: 'y1', edition: '院落版', term: '马鞭',
      context: '表演动作', gloss: '持鞭的动作可示意骑行'
    }
  ]));

  const custom = await readMaterials(pathToFileURL(directory + sep));
  const report = reviewMaterials({
    tables: custom,
    cuts: [{ edition: '院落版', segment: '门口' }]
  });
  const term = report.terms.find(item => item.edition === '院落版' && item.term === '马鞭');
  assert.equal(term.stillExplained, true);
  assert.deepEqual(term.usable.map(item => item.sourceId).sort(), ['x2', 'y1']);
  assert.ok(term.lost.some(item => item.sourceId === 'x1'));
});

test('删去整段不该让其它版本的解释自动补位', async (context) => {
  const scratch = await mkdtemp(join(tmpdir(), 'review-'));
  context.after(() => rm(scratch, { recursive: true, force: true }));
  const directory = join(scratch, '材料');
  await mkdir(directory);
  await cp(new URL('../资料/', import.meta.url), directory, { recursive: true });
  await writeFile(join(directory, '场记.json'), JSON.stringify([
    {
      id: 'a1', edition: '院落版', segment: '门口', language: 'zh',
      role: '阿棠', text: '唱末将马鞭向远方一指。'
    },
    {
      id: 'a2', edition: '溪桥版', segment: '相送', language: 'zh',
      role: '红娘', text: '把鞭借给你。'
    }
  ]));
  await writeFile(join(directory, '词义.json'), JSON.stringify([
    {
      id: 'b1', edition: '院落版', term: '马鞭',
      context: '表演动作', gloss: '持鞭的动作可示意骑行'
    },
    {
      id: 'b2', edition: '溪桥版', term: '马鞭',
      context: '相送', gloss: '角色之间交付的实物'
    }
  ]));
  await writeFile(join(directory, '场次单.json'), JSON.stringify([
    {
      id: 'v1', edition: '院落版', medium: '亲子卡',
      orderedSegments: '门口', maxCharacters: '95'
    },
    {
      id: 'v2', edition: '溪桥版', medium: '亲子卡',
      orderedSegments: '相送', maxCharacters: '90'
    }
  ]));

  const custom = await readMaterials(pathToFileURL(directory + sep));
  const report = reviewMaterials({
    tables: custom,
    cuts: [{ edition: '院落版', segment: '门口' }]
  });
  const term = report.terms.find(item => item.edition === '院落版' && item.term === '马鞭');
  assert.equal(term.stillExplained, false);
  assert.ok(term.lost.every(item => item.kind !== 'stage-note' || item.sourceId === 'a1'));
  const finding = report.termFindings.find(item =>
    item.term === '马鞭' && item.edition === '院落版'
  );
  assert.equal(finding.code, 'term-evidence-lost');
});

// ---------------------------------------------------------------------------
// 读者与篇幅
// ---------------------------------------------------------------------------

test('亲子卡超长时给出字符数与上限', () => {
  const long = {
    ...tables['编辑用稿.json'][0],
    text: 'A real horse is about to enter the stage now. '.repeat(3)
  };
  const custom = {
    ...tables,
    '编辑用稿.json': [long]
  };
  const [copy] = reviewMaterials({ tables: custom }).copies;
  const over = copy.findings.find(finding => finding.code === 'over-length');
  assert.ok(over);
  assert.ok(copy.length.over);
  assert.ok(copy.length.count > copy.length.strictest.maxCharacters);
  assert.equal(copy.length.count, codePointLength(long.text));
});

test('课堂讲义先讲通用概念，再列本场实例，并标出不宜提前讲的身份', () => {
  const report = reportFor();
  const plan = report.classroomPlans.find(item =>
    item.programId === 'visit1' && item.segment === '门口'
  );
  const primerTerms = plan.primer.map(item => item.term);
  assert.ok(primerTerms.includes('阿兄'));
  assert.ok(plan.instances.some(item => item.term === '马鞭'));
  assert.ok(plan.forwardTerms.some(item => item.term === '阿兄'));
  assert.ok(plan.withheld.some(item => item.conceptId === 'elder-brother'));
  const steps = plan.sequence.map(item => item.step);
  assert.equal(steps.indexOf('general') < steps.indexOf('term-instance'), true);
  assert.ok(plan.stageExamples.every(example => example.sourceId === 'song1'));
});

test('节目册的课堂方案只覆盖它真正包含的场次', () => {
  const report = reportFor();
  const plans = report.classroomPlans.filter(item => item.programId === 'visit2');
  assert.deepEqual(plans.map(plan => plan.segment), ['开场', '门口']);
});

// ---------------------------------------------------------------------------
// 报告整体
// ---------------------------------------------------------------------------

test('摘要列出每条改稿的场次、问题与依据', () => {
  const text = summarize(reportFor());
  assert.ok(text.includes('copy1'));
  assert.ok(text.includes('literal-horse'));
  assert.ok(text.includes('song1:15-23'));
  assert.ok(text.includes('term-polysemy'));
});

test('报告为纯数据，可 JSON 往返', () => {
  const report = reportFor([{ edition: '院落版', segment: '门口' }]);
  const roundTrip = JSON.parse(JSON.stringify(report));
  assert.deepEqual(roundTrip.cuts, [
    { edition: '院落版', segment: '门口', applied: true, programs: ['visit1', 'visit2'], reason: null }
  ]);
  assert.ok(roundTrip.copies.every(copy => Array.isArray(copy.findings)));
});

test('单条改稿摘要带句子范围、出处与可选处理', () => {
  const report = reportFor();
  const copy = copyById(report, 'copy1');
  const text = copyDigest(copy, report.cuts);
  assert.ok(text.includes('“horse”（animal）→ sourced/fact song1:15-23[院落版]'));
  assert.ok(text.includes('defer-to-segment → 相认'));
  assert.ok(text.includes('use-established-example'));
});

test('摘要区分本版依据与别版依据', () => {
  const copy = copyById(reportFor(), 'copy3');
  const text = copyDigest(copy);
  assert.ok(text.includes('（别版：song1:4-15[院落版] g1[院落版]）'));
});

test('删段后仍按原节目单上限核对字数', () => {
  const report = reportFor([{ edition: '溪桥版', segment: '相送' }]);
  const copy = copyById(report, 'copy3');
  assert.equal(copy.length.strictest.maxCharacters, 90);
  assert.ok(copyDigest(copy, report.cuts).includes('注意：溪桥版:相送 已被删除'));
});

test('资料目录入口与摘要一致', async () => {
  const report = await reviewFromDirectory();
  assert.equal(report.copies.length, 3);
  assert.equal(report.terms.length, 3);
});
