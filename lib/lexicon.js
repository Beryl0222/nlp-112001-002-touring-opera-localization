// 双语概念锚点：只用于把英文改稿与中文场记、词义对齐，不替代编辑判断。
//
// 每个概念的中英文说法都按“候选”处理：
// - terms 是场记/词义里可能出现的说法；
// - english 是英文改稿里可能采用的说法，class 表示该说法落入的语义类别；
// - 未收录的说法不会被强行猜测，报告会把它列为“无法追溯”。
//
// 编辑可在此增补本剧种的常用说法；新增概念后，场记、词表、改稿的
// 对齐和“同一概念不同译法”的检查会自动适用。

export const CONCEPTS = [
  {
    id: 'horse-whip',
    label: '马鞭',
    terms: ['马鞭', '鞭'],
    english: [
      { cue: 'riding crop', class: 'object' },
      { cue: 'horsewhip', class: 'object' },
      { cue: 'whip', class: 'object' },
      { cue: 'crop', class: 'object' }
    ]
  },
  {
    id: 'horse',
    label: '马',
    terms: ['马'],
    english: [
      { cue: 'horse', class: 'animal' },
      { cue: 'steed', class: 'animal' }
    ],
    // “上马”“马鞭”里的“马”不是独立登场的马。
    termPattern: /(?<![上骑])(?<!马)马(?![鞭])/u
  },
  {
    id: 'mount',
    label: '上马、骑行',
    terms: ['上马', '骑行', '骑马'],
    english: [
      { cue: 'mount', class: 'motion' },
      { cue: 'mounts', class: 'motion' },
      { cue: 'mounting', class: 'motion' },
      { cue: 'mounted', class: 'motion' },
      { cue: 'mimes', class: 'motion' },
      { cue: 'mimed', class: 'motion' },
      { cue: 'ride', class: 'motion' },
      { cue: 'rides', class: 'motion' },
      { cue: 'riding', class: 'motion' },
      { cue: 'gallop', class: 'motion' }
    ]
  },
  {
    id: 'empty-stage',
    label: '空台、无实物',
    terms: ['空台', '没有实物', '无实物'],
    english: [
      { cue: 'bare stage', class: 'negation' },
      { cue: 'empty stage', class: 'negation' },
      { cue: 'no real horse', class: 'negation' },
      { cue: 'no horse', class: 'negation' },
      { cue: 'without a horse', class: 'negation' }
    ]
  },
  {
    id: 'symbolic-action',
    label: '虚拟动作',
    terms: ['虚拟动作', '虚拟', '示意', '动作'],
    english: [
      { cue: 'stylized movement', class: 'convention' },
      { cue: 'stylized', class: 'convention' },
      { cue: 'mime', class: 'convention' },
      { cue: 'symbolic', class: 'convention' },
      { cue: 'suggests', class: 'convention' },
      { cue: 'suggesting', class: 'convention' }
    ]
  },
  {
    id: 'elder-brother',
    label: '阿兄、师兄、同门',
    terms: ['阿兄', '师兄', '同门'],
    english: [
      { cue: 'older fellow apprentice', class: 'mentor' },
      { cue: 'senior fellow apprentice', class: 'mentor' },
      { cue: 'fellow apprentice', class: 'mentor' },
      { cue: 'apprentice', class: 'mentor' },
      { cue: 'brother', class: 'kin' },
      { cue: 'sibling', class: 'kin' }
    ]
  },
  {
    id: 'recognition',
    label: '相认、认出、识人',
    terms: ['相认', '认出', '识人'],
    english: [
      { cue: 'recognize', class: 'recognition' },
      { cue: 'recognizes', class: 'recognition' },
      { cue: 'recognized', class: 'recognition' },
      { cue: 'recognition', class: 'recognition' },
      { cue: 'identify', class: 'recognition' },
      { cue: 'identifies', class: 'recognition' }
    ]
  },
  {
    id: 'disguise',
    label: '扮作生人',
    terms: ['扮作', '生人', '陌生人'],
    english: [
      { cue: 'pretending', class: 'disguise' },
      { cue: 'pretend', class: 'disguise' },
      { cue: 'pretends', class: 'disguise' },
      { cue: 'stranger', class: 'disguise' },
      { cue: 'disguise', class: 'disguise' },
      { cue: 'disguised', class: 'disguise' }
    ]
  },
  {
    id: 'passenger',
    label: '船客',
    terms: ['船客'],
    english: [
      { cue: 'passenger', class: 'role' },
      { cue: 'boat passenger', class: 'role' }
    ]
  },
  {
    id: 'farewell',
    label: '送行',
    terms: ['送行', '相送', '路远慢走'],
    english: [
      { cue: 'safe journey', class: 'farewell' },
      { cue: 'farewell', class: 'farewell' },
      { cue: 'send-off', class: 'farewell' },
      { cue: 'see off', class: 'farewell' }
    ]
  },
  {
    id: 'lend-whip',
    label: '借鞭、交付',
    terms: ['借鞭', '借给你', '交付', '借'],
    english: [
      { cue: 'hands', class: 'transfer' },
      { cue: 'hand', class: 'transfer' },
      { cue: 'lends', class: 'transfer' },
      { cue: 'lend', class: 'transfer' },
      { cue: 'gives', class: 'transfer' },
      { cue: 'give', class: 'transfer' },
      { cue: 'borrow', class: 'transfer' }
    ]
  },
  {
    id: 'wagon',
    label: '车、车夫',
    terms: ['马车', '车夫', '马夫', '车'],
    english: [
      { cue: 'wagon keeper', class: 'role' },
      { cue: 'wagon', class: 'vehicle' },
      { cue: 'cart', class: 'vehicle' },
      { cue: 'driver', class: 'role' }
    ]
  },
  {
    id: 'host',
    label: '主持人',
    terms: ['主持', '主持人'],
    english: [
      { cue: 'host', class: 'role' }
    ]
  }
];

export const CONCEPT_BY_ID = new Map(CONCEPTS.map(concept => [concept.id, concept]));

// 身份类概念一旦提前出现，亲子场会泄露尚未揭晓的关系。
export const IDENTITY_CONCEPTS = new Set(['elder-brother', 'recognition', 'disguise']);

// 场记行文中的提示词，用来区分对白、唱词、动作和编辑补充。
export const STAGE_ACTION_MARKERS =
  /^(?:空台|台上|舞台|动作|身段|亮相|上场|下场|内景|外景)|没有实物|无实物|向.{0,8}一指|持鞭|以.{0,10}为情节/u;
export const EDITORIAL_MARKERS = /^(?:该段|此段|按注|注[:：]|说明[:：]|编辑[:：])/u;
export const LYRIC_MARKERS = /^(?:唱|念|引子|上句|下句)[:：]?/u;
export const NARRATION_MARKERS =
  /^(?:这一声|此前|原来|原是|本是|后来|据说)|认出|叙述/u;
