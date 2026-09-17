# Explorer File Nav

Switch between files **in the exact order shown in the Explorer panel**.

VS Code's built-in `Ctrl+PageDown` only cycles between **already-open** editors. This extension walks the file tree in Explorer order, so you can read a project file-by-file — docs, course notes, tutorial chapters — without touching the mouse.

## Features

- **Explorer-exact order** — a folder's contents are visited in place, and when a folder ends, navigation continues at the next entry of its parent.
- **Respects your sort settings** — `explorer.sortOrder`: `default` / `mixed` / `filesFirst` / `type` / `modified` / `created`, plus `explorer.sortOrderLexicographicOptions`: `default` / `upper` / `lower`.
- **Respects `files.exclude`** — nothing invisible gets opened.
- **Follows symbolic links / junctions** (with a depth guard).
- **Instant & workspace-size independent** — no workspace-wide indexing. Each navigation only reads the directory chain from the current file up to the workspace root (typically 3–10 reads).

## Commands

| Command ID | Title |
|---|---|
| `explorerFileNav.next` | Explorer File Nav: 下一个文件（资源管理器顺序） |
| `explorerFileNav.previous` | Explorer File Nav: 上一个文件（资源管理器顺序） |

No default keybindings. Bind your own, for example:

```json
[
  { "key": "alt+]", "command": "explorerFileNav.next" },
  { "key": "alt+[", "command": "explorerFileNav.previous" }
]
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `explorerFileNav.wrap` | `true` | Wrap around at the first / last file. |
| `explorerFileNav.skipExcluded` | `true` | Skip items excluded by `files.exclude` so ordering matches the Explorer. |
| `explorerFileNav.maxDepth` | `30` | Max recursion depth when diving into a folder (also guards against link cycles). |
| `explorerFileNav.showTiming` | `false` | Show navigation timing in the status bar (debugging). |

## Notes

- Folders come first for `default` / `type` / `modified` / `created` modes, matching the Explorer. If you spot any mismatch, please open an issue and include your `explorer.sortOrder` value.
- Only local files (`file:` scheme) are supported.

## License

MIT
