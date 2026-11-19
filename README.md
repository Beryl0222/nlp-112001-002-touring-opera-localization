# 巡演戏曲的跨文化解说编校

两站巡演排练资料采用 UTF-8 编码，人物、单位和记录均为合成内容。

| 资料 | 字段 |
| --- | --- |
| `资料/场记.json` | `id`、`edition`、`segment`、`language`、`role`、`text` |
| `资料/词义.json` | `id`、`edition`、`term`、`context`、`gloss` |
| `资料/编辑用稿.json` | `id`、`segment`、`language`、`medium`、`text` |
| `资料/场次单.json` | `id`、`edition`、`medium`、`orderedSegments`、`maxCharacters` |

每份资料是 JSON 数组。记录中的字段值按来源原样保留为字符串，逗号和顿号可以属于字段内容。资料中可能有转述、不同的拼写以及较晚录入的更正。数字及日期在这些文件中沿用各资料自身的含义；原文位置以记录编号及文本范围定位。

Node.js 22 环境下运行以下命令可安装锁定的项目环境、检查素材格式并读取各类资料的数量。

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm test
npm run materials
```

`readMaterials` 只读取资料，不解析其中的正文含义。
