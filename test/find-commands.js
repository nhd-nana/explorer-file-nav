'use strict';

/* 在 VS Code 的 workbench 打包文件里搜命令 ID（用于确认某个内置命令是否存在）。
 * 用法： node test/find-commands.js "<workbench.desktop.main.js 路径>" 关键词1 [关键词2 ...]
 */

const fs = require('fs');

const file = process.argv[2];
const words = process.argv.slice(3);
if (!file || words.length === 0) {
    console.log('用法: node test/find-commands.js "<workbench.desktop.main.js>" 关键词...');
    process.exit(1);
}

const src = fs.readFileSync(file, 'utf8');
for (const w of words) {
    const re = new RegExp('[\\w.]*' + w + '[\\w.]*', 'g');
    const hits = [...new Set(src.match(re) || [])].slice(0, 6);
    console.log(w.padEnd(30), '→', hits.length ? hits.join('   |   ') : '(未找到)');
}
