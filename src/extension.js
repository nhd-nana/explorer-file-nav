'use strict';

const vscode = require('vscode');
const path = require('path');

/* ------------------------------------------------------------------ *
 * Explorer File Nav — 按「资源管理器显示顺序」切换文件
 *
 * 设计要点：
 *  1. 不做全工作区索引：每次按键只读「当前目录 + 逐级父目录」这一条链
 *     （O(深度) 次 readDirectory，通常 3~10 次）→ 瞬时响应、工作区大小无关。
 *  2. 排序逻辑复刻资源管理器的 explorer.sortOrder /
 *     explorer.sortOrderLexicographicOptions。
 *  3. 尊重 files.exclude，与资源管理器里看到的顺序一致。
 *  4. 支持符号链接 / junction（stat 解析真实类型，并靠 maxDepth 防环）。
 * ------------------------------------------------------------------ */

const FILE = vscode.FileType.File;
const DIR = vscode.FileType.Directory;
const LINK = vscode.FileType.SymbolicLink;

/** 最近一次活动的文本编辑器（当前是纯 webview 时用于兼底） */
let lastTextUri = null;

/* ------------------- 确定「当前文件」 ------------------- */

function activeTab() {
    const g = vscode.window.tabGroups && vscode.window.tabGroups.activeTabGroup;
    return g && g.activeTab ? g.activeTab : null;
}

function stripPreviewAffixes(label) {
    return String(label || '')
        .replace(/\s*\((Preview|预览|Read-Only|只读|Side by Side)\)\s*$/i, '')
        .replace(/^\s*(Preview|预览)\s*[:：\-\s]\s*/i, '')
        .replace(/\s*\[(Preview|预览)\]\s*$/i, '')
        .trim();
}

/** 纯 webview 标签拿不到 uri → 用标签标题到「已打开的文本标签」里反查源文件 */
function matchByTabLabel(tab) {
    if (!tab || !tab.label) return null;
    const raw = String(tab.label).toLowerCase();
    const want = stripPreviewAffixes(tab.label).toLowerCase();
    if (!want) return null;
    const groups = (vscode.window.tabGroups && vscode.window.tabGroups.all) || [];
    for (const g of groups) {
        for (const t of g.tabs) {
            const input = t.input;
            if (!(vscode.TabInputText && input instanceof vscode.TabInputText)) continue;
            const label = String(t.label || '').toLowerCase();
            const fname = path.basename(input.uri.fsPath).toLowerCase();
            if (label === raw || label === want || fname === want) return input.uri;
        }
    }
    return null;
}

function activeFileTarget() {
    const ed = vscode.window.activeTextEditor;
    if (ed) return { uri: ed.document.uri, viewType: null, via: 'activeTextEditor' };

    const tab = activeTab();
    const input = tab && tab.input;
    if (input) {
        if (vscode.TabInputCustom && input instanceof vscode.TabInputCustom) {
            return { uri: input.uri, viewType: input.viewType || null, via: 'customEditor' };
        }
        if (vscode.TabInputText && input instanceof vscode.TabInputText) {
            return { uri: input.uri, viewType: null, via: 'tabInputText' };
        }
        if (vscode.TabInputNotebook && input instanceof vscode.TabInputNotebook) {
            return { uri: input.uri, viewType: null, via: 'notebook' };
        }
    }

    // 纯 webview：先按「标签标题反查」（比“最近活动编辑器”精确），再退回它
    const byLabel = matchByTabLabel(tab);
    if (byLabel) return { uri: byLabel, viewType: null, via: 'tabLabel' };

    if (lastTextUri) return { uri: lastTextUri, viewType: null, via: 'lastTextEditor' };
    const vis = vscode.window.visibleTextEditors;
    if (vis && vis.length) return { uri: vis[0].document.uri, viewType: null, via: 'firstVisible' };
    return null;
}

/* ---------------------------- 配置 ---------------------------- */

function getOpts() {
    const explorerCfg = vscode.workspace.getConfiguration('explorer');
    const filesCfg = vscode.workspace.getConfiguration('files');
    const selfCfg = vscode.workspace.getConfiguration('explorerFileNav');
    return {
        sortOrder: explorerCfg.get('sortOrder', 'default'),
        lexico: explorerCfg.get('sortOrderLexicographicOptions', 'default'),
        exclude: filesCfg.get('exclude', {}) || {},
        skipExcluded: selfCfg.get('skipExcluded', true),
        wrap: selfCfg.get('wrap', true),
        maxDepth: selfCfg.get('maxDepth', 30),
        showTiming: selfCfg.get('showTiming', false),
        followInExplorer: selfCfg.get('followInExplorer', 'off'),
    };
}

/* ------------------- glob → RegExp（** * ? {} ） ------------------- */

function expandBraces(glob) {
    const m = /\{([^{}]*)\}/.exec(glob);
    if (!m) return [glob];
    const out = [];
    for (const part of m[1].split(',')) {
        out.push(...expandBraces(glob.slice(0, m.index) + part + glob.slice(m.index + m[0].length)));
    }
    return out;
}

function globToRegExp(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
                else { re += '.*'; i += 1; }
            } else {
                re += '[^/]*';
            }
        } else if (c === '?') {
            re += '[^/]';
        } else if ('\\^$.|+()[]'.includes(c)) {
            re += '\\' + c;
        } else {
            re += c;
        }
    }
    return new RegExp('^' + re + '$', 'i');
}

function buildMatchers(exclude) {
    const out = [];
    for (const glob of Object.keys(exclude || {})) {
        const val = exclude[glob];
        const enabled = typeof val === 'boolean' ? val : !!(val && val.when);
        if (!enabled) continue;
        for (const g of expandBraces(glob)) out.push(globToRegExp(g));
    }
    return out;
}

/* ---------------------------- 工具 ---------------------------- */

function parentOf(uri) {
    const p = path.dirname(uri.fsPath);
    return p === uri.fsPath ? null : vscode.Uri.file(p);
}

function withinRoot(uri, rootUri) {
    const a = path.resolve(uri.fsPath);
    const b = path.resolve(rootUri.fsPath);
    return a === b || a.startsWith(b + path.sep);
}

function samePath(a, b) {
    return path.resolve(a) === path.resolve(b);
}

async function resolveType(uri, rawType) {
    if (!(rawType & LINK)) return rawType;
    try {
        const st = await vscode.workspace.fs.stat(uri);
        return st.type;
    } catch {
        return 0;
    }
}

/* ---------------------------- 排序 ---------------------------- */

function cmpName(a, b, lexico) {
    let x = a.name;
    let y = b.name;
    if (lexico === 'upper') { x = x.toUpperCase(); y = y.toUpperCase(); }
    else if (lexico === 'lower') { x = x.toLowerCase(); y = y.toLowerCase(); }
    const c = x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
    return c !== 0 ? c : a.name.localeCompare(b.name);
}

function sortItems(items, o) {
    const byName = (a, b) => cmpName(a, b, o.lexico);
    const group = (a, b) => {
        if (o.sortOrder === 'mixed') return 0;
        if (o.sortOrder === 'filesFirst') return (a.isDir ? 1 : 0) - (b.isDir ? 1 : 0);
        return (b.isDir ? 1 : 0) - (a.isDir ? 1 : 0);
    };
    const tie = (a, b) => {
        switch (o.sortOrder) {
            case 'type': {
                const ea = path.extname(a.name).toLowerCase();
                const eb = path.extname(b.name).toLowerCase();
                return ea.localeCompare(eb) || byName(a, b);
            }
            case 'modified':
                return (b.mtime - a.mtime) || byName(a, b);
            case 'created':
                return (b.ctime - a.ctime) || byName(a, b);
            default:
                return byName(a, b);
        }
    };
    return items.sort((a, b) => group(a, b) || tie(a, b));
}

/* ------------------- 读目录（已过滤 + 已排序） ------------------- */

async function listSorted(dirUri, o, rootUri, matchers) {
    let entries;
    try {
        entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch {
        return [];
    }
    const items = [];
    for (const [name, rawType] of entries) {
        const uri = vscode.Uri.joinPath(dirUri, name);
        if (o.skipExcluded && matchers.length) {
            const rel = path.posix.relative(rootUri.path, uri.path);
            if (matchers.some((m) => m.test(rel))) continue;
        }
        const type = await resolveType(uri, rawType);
        const isDir = (type & DIR) !== 0;
        if (!isDir && !(type & FILE)) continue;
        items.push({ name, uri, isDir, mtime: 0, ctime: 0 });
    }
    if (o.sortOrder === 'modified' || o.sortOrder === 'created') {
        await Promise.all(items.map(async (it) => {
            try {
                const st = await vscode.workspace.fs.stat(it.uri);
                it.mtime = st.mtime;
                it.ctime = st.ctime;
            } catch { /* ignore */ }
        }));
    }
    return sortItems(items, o);
}

/* -------- 下潜：取某目录内 DFS 序的第一个 / 最后一个文件 -------- */

async function deepestFirst(dirUri, o, rootUri, matchers, depth) {
    if (depth > o.maxDepth) return null;
    for (const it of await listSorted(dirUri, o, rootUri, matchers)) {
        if (!it.isDir) return it.uri;
        const r = await deepestFirst(it.uri, o, rootUri, matchers, depth + 1);
        if (r) return r;
    }
    return null;
}

async function deepestLast(dirUri, o, rootUri, matchers, depth) {
    if (depth > o.maxDepth) return null;
    const items = await listSorted(dirUri, o, rootUri, matchers);
    for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (!it.isDir) return it.uri;
        const r = await deepestLast(it.uri, o, rootUri, matchers, depth + 1);
        if (r) return r;
    }
    return null;
}

/* ----------------- 主逻辑：找当前文件在树中的邻居 ----------------- */

async function findNeighbor(currentUri, dir, o) {
    const wf = vscode.workspace.getWorkspaceFolder(currentUri);
    if (!wf) return null;
    const rootUri = wf.uri;
    const matchers = o.skipExcluded ? buildMatchers(o.exclude) : [];

    let node = currentUri;
    for (let guard = 0; guard <= o.maxDepth + 64; guard++) {
        const parent = parentOf(node);
        if (!parent || !withinRoot(parent, rootUri)) break;

        const items = await listSorted(parent, o, rootUri, matchers);
        const idx = items.findIndex((it) => samePath(it.uri.fsPath, node.fsPath));

        if (idx !== -1) {
            if (dir === 'next') {
                for (let i = idx + 1; i < items.length; i++) {
                    const it = items[i];
                    if (!it.isDir) return it.uri;
                    const deep = await deepestFirst(it.uri, o, rootUri, matchers, 0);
                    if (deep) return deep;
                }
            } else {
                for (let i = idx - 1; i >= 0; i--) {
                    const it = items[i];
                    if (!it.isDir) return it.uri;
                    const deep = await deepestLast(it.uri, o, rootUri, matchers, 0);
                    if (deep) return deep;
                }
            }
        }

        if (samePath(parent.fsPath, rootUri.fsPath)) break;
        node = parent;
    }

    if (!o.wrap) return null;
    return dir === 'next'
        ? await deepestFirst(rootUri, o, rootUri, matchers, 0)
        : await deepestLast(rootUri, o, rootUri, matchers, 0);
}

/* ---------------------------- 命令 ---------------------------- */

async function navigate(dir) {
    const here = activeFileTarget();
    if (!here) {
        vscode.window.showInformationMessage('Explorer File Nav：找不到当前文件，请先打开一个文件或预览');
        return;
    }
    const currentUri = here.uri;
    if (currentUri.scheme !== 'file') {
        vscode.window.showInformationMessage('Explorer File Nav：只支持本地文件');
        return;
    }

    const o = getOpts();
    const t0 = Date.now();
    let target = null;
    try {
        target = await findNeighbor(currentUri, dir, o);
    } catch (e) {
        vscode.window.showErrorMessage(
            'Explorer File Nav 出错：' + (e && e.message ? e.message : String(e)));
        return;
    }

    if (!target || samePath(target.fsPath, currentUri.fsPath)) {
        vscode.window.setStatusBarMessage(
            dir === 'next' ? 'Explorer File Nav：已是最后一个文件' : 'Explorer File Nav：已是第一个文件',
            2500);
        return;
    }

    // 用 VS Code 的「打开资源」入口打开 —— 与在资源管理器里点击文件完全一致：
    // 会走 workbench.editorAssociations + 各自定义编辑器优先级的完整解析。
    // ⚠️ 不要用 openWith(uri, 'default')：那里的 'default' 指内置文本编辑器，不会解析 editorAssociations。
    // preview: true：复用同一个标签（与文本编辑器的预览行为一致）。
    try {
        await vscode.commands.executeCommand('vscode.open', target, { preview: true });
    } catch {
        await vscode.window.showTextDocument(target, { preview: true });
    }

    if (o.showTiming) {
        vscode.window.setStatusBarMessage(`Explorer File Nav：${Date.now() - t0} ms`, 2000);
    }

    // 可选：让资源管理器跟随当前文件（避免跨目录后一堆展开的分支）
    if (o.followInExplorer && o.followInExplorer !== 'off') {
        try {
            if (o.followInExplorer === 'collapseAndReveal') {
                await vscode.commands.executeCommand('workbench.files.action.collapseExplorerFolders');
            }
            await vscode.commands.executeCommand('revealInExplorer', target);
        } catch { /* 忽略：资源管理器不可用时不影响跳转 */ }
    }
}

function inputKind(input) {
    if (!input) return '(无)';
    if (vscode.TabInputText && input instanceof vscode.TabInputText) return '文本编辑器';
    if (vscode.TabInputCustom && input instanceof vscode.TabInputCustom) {
        return `自定义编辑器（${input.viewType}）`;
    }
    if (vscode.TabInputNotebook && input instanceof vscode.TabInputNotebook) return 'Notebook';
    if (vscode.TabInputWebview && input instanceof vscode.TabInputWebview) {
        return `Webview 面板（${input.viewType}）`;
    }
    if (vscode.TabInputTextDiff && input instanceof vscode.TabInputTextDiff) return '文本 Diff';
    return input.constructor ? input.constructor.name : '(未知)';
}

async function diagnose() {
    const t = activeFileTarget();
    const tab = activeTab();
    const inputName = inputKind(tab && tab.input);
    const lines = [
        `当前标签：${tab ? tab.label : '(无标签)'}`,
        `标签输入类型：${inputName}`,
        `activeTextEditor：${vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri.fsPath : '(无)'}`,
        `识别到的文件：${t ? t.uri.fsPath : '(未识别)'}`,
        `识别依据：${t ? t.via : '-'}`,
        `最近活动的文本编辑器：${lastTextUri ? lastTextUri.fsPath : '(无)'}`,
    ];
    await vscode.window.showInformationMessage(lines.join('\n'), { modal: true });
}

function activate(context) {
    if (vscode.window.activeTextEditor) lastTextUri = vscode.window.activeTextEditor.document.uri;
    context.subscriptions.push(
        vscode.commands.registerCommand('explorerFileNav.next', () => navigate('next')),
        vscode.commands.registerCommand('explorerFileNav.previous', () => navigate('prev')),
        vscode.commands.registerCommand('explorerFileNav.diagnose', diagnose),
        vscode.window.onDidChangeActiveTextEditor((ed) => {
            if (ed && ed.document.uri.scheme === 'file') lastTextUri = ed.document.uri;
        }),
    );
}

function deactivate() { }

module.exports = { activate, deactivate };
