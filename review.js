#!/usr/bin/env node
// 编校报告入口。
//
//   npm run review
//   npm run review -- --cut 院落版:门口
//   npm run review -- --cut 院落版:门口 --json

import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reviewFromDirectory, summarize, copyDigest } from './lib/review.js';

function fail(message) {
  const error = new Error(message);
  error.usage = true;
  throw error;
}

function parseArgs(argv) {
  const options = { cuts: [], json: false, directory: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--copy') {
      const value = argv[index + 1];
      index += 1;
      if (!value) fail('--copy 需要改稿编号，例如 copy1');
      options.copy = value;
    } else if (arg === '--cut') {
      const value = argv[index + 1];
      index += 1;
      if (!value) fail('--cut 需要“版本:场次”，例如 院落版:门口');
      const separator = value.lastIndexOf(':');
      if (separator <= 0) fail(`--cut 的写法应为“版本:场次”，收到 ${value}`);
      options.cuts.push({
        edition: value.slice(0, separator),
        segment: value.slice(separator + 1)
      });
    } else if (arg === '--directory') {
      options.directory = argv[index + 1];
      index += 1;
      if (!options.directory) fail('--directory 需要资料目录');
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      fail(`无法识别的参数：${arg}`);
    }
  }
  return options;
}

const usage = `用法：node review.js [选项]

  --cut 版本:场次   模拟删除某版本的一个场次，再重新核对改稿与解释依据；可重复
  --copy 编号       只详列某条改稿的句子、依据与可选处理
  --json            输出完整报告（JSON）
  --directory 目录  资料目录，默认 ./资料/
`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }
  const directory = options.directory
    ? pathToFileURL(resolve(options.directory, '') + sep)
    : undefined;
  const report = await reviewFromDirectory(directory, { cuts: options.cuts });

  if (options.copy) {
    const copy = report.copies.find(item => item.copyId === options.copy);
    if (!copy) fail(`报告里没有改稿 ${options.copy}`);
    process.stdout.write(options.json
      ? `${JSON.stringify(copy, null, 2)}\n`
      : copyDigest(copy, report.cuts));
    return;
  }
  process.stdout.write(options.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : summarize(report));
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  if (error.usage) process.stderr.write(usage);
  process.exitCode = 1;
});
