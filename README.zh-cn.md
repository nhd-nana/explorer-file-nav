# Explorer File Nav（资源管理器顺序切换文件）

按**左侧资源管理器显示的顺序**切换上一个 / 下一个文件。

VS Code 内置的 `Ctrl+PageDown` 只在**已打开**的编辑器之间循环；本扩展沿着文件树按资源管理器的顺序遍历，适合**逐篇通读**项目文件（文档、课件、教程章节），全程不用碰鼠标。

## 特性

- **顺序与资源管理器完全一致**：一个文件夹的内容在本位访问，文件夹读完后接着读它的下一个兄弟条目。
- **跟随你的排序设置**：`explorer.sortOrder`（名称 / 混合 / 文件优先 / 类型 / 修改时间 / 创建时间）+ `explorer.sortOrderLexicographicOptions`（默认 / 大写 / 小写）。
- **尊重 `files.exclude`**：不会打开你根本看不见的文件。
- **支持符号链接 / junction**（带深度防护）。
- **瞬时响应，与工作区大小无关**：不做全工作区索引，每次只读「当前文件 → 工作区根」这条目录链（通常 3~10 次目录读取）。

## 命令

| 命令 ID | 标题 |
|---|---|
| `explorerFileNav.next` | 下一个文件（资源管理器顺序） |
| `explorerFileNav.previous` | 上一个文件（资源管理器顺序） |

默认不带快捷键，自行绑定即可：

```json
[
  { "key": "alt+]", "command": "explorerFileNav.next" },
  { "key": "alt+[", "command": "explorerFileNav.previous" }
]
```

## 设置

| 设置项 | 默认 | 说明 |
|---|---|---|
| `explorerFileNav.wrap` | `true` | 到最后一个 / 第一个文件时循环。 |
| `explorerFileNav.skipExcluded` | `true` | 跳过 `files.exclude` 排除的项，保持与资源管理器一致。 |
| `explorerFileNav.maxDepth` | `30` | 下潜查找时的最大递归深度（同时防止链接成环）。 |
| `explorerFileNav.showTiming` | `false` | 在状态栏显示本次查找耗时（调试用）。 |

## 说明

- `default` / `type` / `modified` / `created` 模式下**文件夹在前**，与资源管理器一致。若发现顺序不一致，请附上你的 `explorer.sortOrder` 值提 issue。
- 仅支持本地文件（`file:` 协议）。

## 许可证

MIT
