// 介质策略：不同读者能看到什么、什么时候能看到。
//
// 这些策略会随巡演调整；改这里即可，不要把它硬编码进报告逻辑。

export const MEDIUM_PROFILES = [
  {
    match: /亲子/u,
    id: 'family-card',
    label: '亲子场节目卡',
    audience: 'family',
    // 面向观众、随身携带的卡片：只能讲本场及之前已经演到的内容。
    restrictToCurrentAndPast: true,
    // 节目卡按场次单印，必须对得上某个演出。
    tiedToProgram: true,
    forbidForwardIdentity: true,
    forbidForwardConcepts: true,
    explainsGeneralConcepts: false,
    lengthFromProgram: true
  },
  {
    match: /节目册|节目单|手册/u,
    id: 'program-book',
    label: '节目册',
    audience: 'general',
    restrictToCurrentAndPast: true,
    tiedToProgram: true,
    forbidForwardIdentity: true,
    forbidForwardConcepts: true,
    explainsGeneralConcepts: false,
    lengthFromProgram: true
  },
  {
    match: /课堂|讲义|教学|教师/u,
    id: 'classroom',
    label: '课堂讲义',
    audience: 'teacher',
    // 课堂可以先讲通用概念，再比较本场实例；但仍要标出会提前泄露的剧情身份。
    restrictToCurrentAndPast: false,
    // 讲义不随某一场的节目单发放，但仍要绑定版本与场次核对依据。
    tiedToProgram: false,
    forbidForwardIdentity: true,
    forbidForwardConcepts: false,
    explainsGeneralConcepts: true,
    lengthFromProgram: false
  }
];

const DEFAULT_PROFILE = {
  id: 'unspecified',
  label: '未登记介质',
  audience: 'unknown',
  restrictToCurrentAndPast: true,
  tiedToProgram: true,
  forbidForwardIdentity: true,
  forbidForwardConcepts: true,
  explainsGeneralConcepts: false,
  lengthFromProgram: false
};

export function profileFor(medium) {
  return MEDIUM_PROFILES.find(profile => profile.match.test(medium)) ?? {
    ...DEFAULT_PROFILE,
    label: `未登记介质（${medium}）`
  };
}
