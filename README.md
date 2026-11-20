# 巡演戏曲的跨文化解说编校

两站巡演排练资料采用 UTF-8 编码，人物、单位和记录均为合成内容。

| 资料 | 字段 |
| --- | --- |
| `资料/场记.json` | `id`、`edition`、`segment`、`language`、`role`、`text` |
| `资料/词义.json` | `id`、`edition`、`term`、`context`、`gloss` |
| `资料/编辑用稿.json` | `id`、`segment`、`language`、`medium`、`text` |
| `资料/场次单.json` | `id`、`edition`、`medium`、`orderedSegments`、`maxCharacters` |

每份资料是 JSON 数组。记录中的字段值按来源原样保留为字符串，逗号和顿号可以属于字段内容。资料中可能有转述、不同的拼写以及较晚录入的更正。数字及日期在这些文件中沿用各资料自身的含义；原文位置以记录编号及文本范围定位。

## 运行

Node.js 22 环境下：

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm test
npm run materials   # 只检查格式并读取各类资料数量
npm run review      # 编校报告
```

`materials.js` 的 `readMaterials` 只读取资料，不解析正文含义；编校判断都在 `lib/` 里，并且不修改来稿。

## 编校工具

`review.js` 把场记、唱词、词义、编辑改稿和场次单放在一起核对，输出的是**定位、依据和可选处理**，不会自动改稿，也不会在多种解释之间替编辑选一个。

```sh
npm run review                                  # 全部改稿与术语摘要
npm run review -- --cut 院落版:门口             # 模拟删段后再核对
npm run review -- --copy copy1                  # 单条改稿的逐句明细
npm run review -- --cut 院落版:门口 --copy copy1
npm run review -- --json                        # 完整报告（纯数据）
```

### 报告里有什么

- **节目单**：每个演出的场次、已删场次、改稿字数与上限。
- **每句改稿**：`verdict` 表示整句能否成立；`traces` 逐个说法给出查找结果。
  - `status` 为 `sourced`（本场有依据）、`established-earlier`（前场已讲）、`forward`（只在后续场次出现）、`other-edition`（只在别的版本有）、`unsourced`（查无出处）。
  - `sourceKind` 区分 `fact`（对白、唱词、动作）与 `commentary`（叙述、编辑补充），编辑能看出保留的剧情事实来自哪里、补充说明是什么。
  - 每条依据都带 `sourceId` 与 `start`/`end`，可直接 `text.slice(start, end)` 切回原句；别版依据单列在 `otherEditionSources`。
  - `alternatives` 保留同一说法在本版词表里的多个解释，供编辑选择。
- **问题**：`literal-horse`、`kin-vs-mentor`、`identity-spoiler`、`pairing-compound-arrival` 等，均带 `severity`、出处与 `options`（删句、改写概念、改用前场实例、留到某场次、先核出处）。
- **术语**：逐版本列出仍可用与因删段失效的解释。某术语在同一版本其它场次另有独立证据时仍保留；只有别版有解释时不会自动补位。
- **课堂讲义**：按场次给出先讲的通用概念、本场实例、需要铺垫但不宜提前点名的说法，以及尚未揭晓的身份。
- **多义提示**：同一术语在不同版本承担不同含义时单独列出，提醒释义必须绑定版本。

### 判断依据

- **版本**：词义只在本版本内生效；“马鞭”在院落版是示意动作，在溪桥版是实物，不能互借。
- **场次与顺序**：按场次单的 `orderedSegments` 推演；删段后重新排序，`forward` 不再算作本场依据。
- **读者**：介质策略在 `lib/profiles.js`。亲子卡与节目册只能讲本场及之前的内容；课堂可以先讲通用概念，但身份类概念仍标为不可提前。
- **篇幅**：按 Unicode 码点计数，并与 `maxCharacters` 比较；删段后仍按原上限核对。
- **语气**：场记按对白、唱词、动作、叙述、编辑补充切分（`lib/stage.js`）。

### 可调整处

- `lib/lexicon.js`：中英文概念锚点、身份类概念、场记语气提示词。未收录的说法会落入 `unsourced`，不会被强行猜测。
- `lib/profiles.js`：各介质的受众与超前限制。
- `lib/evidence.js`：词义条目如何锚定场次、删段后如何盘点依据。

## 边界

- 中英对齐依赖 `lib/lexicon.js` 中的概念锚点；词表只提供候选，新说法应在此补充后再核对。
- 语气切分是启发式提示，编辑仍应回到原句核对；报告中的每条引用都可直接定位回原文。
- 工具不判断艺术取舍，也不生成最终译文。
