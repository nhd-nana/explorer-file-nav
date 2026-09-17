'use strict';

/* 独立验证脚本：mock vscode API + 真实文件系统，验证「资源管理器顺序」是否正确。
 * 用法： node test/simulate.js <起始文件> next|prev [sortOrder]
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = 'D:\\Code';
const SORT_ORDER = process.argv[4] || 'default';

const FT = { File: 1, Directory: 2, SymbolicLink: 64 };

function toUri(fsPath) {
    const p = fsPath.replace(/\\/g, '/');
    return { scheme: 'file', fsPath, path: p.startsWith('/') ? p : '/' + p, toString: () => 'file:///' + p };
}

const rootUri = toUri(ROOT);

class TabInputCustom { constructor(uri, viewType) { this.uri = uri; this.viewType = viewType; } }
class TabInputText { constructor(uri) { this.uri = uri; } }
class TabInputNotebook { }

const mockVscode = {
    FileType: FT,
    TabInputCustom,
    TabInputText,
    TabInputNotebook,
    Uri: {
        file: (p) => toUri(p),
        joinPath: (uri, name) => toUri(path.join(uri.fsPath, name)),
    },
    workspace: {
        getWorkspaceFolder: () => ({ uri: rootUri, name: 'Code', index: 0 }),
        getConfiguration: (section) => ({
            get: (key, def) => {
                const table = {
                    'explorer.sortOrder': SORT_ORDER,
                    'explorer.sortOrderLexicographicOptions': 'default',
                    'files.exclude': { '**/.git': true, '**/node_modules': true },
                    'explorerFileNav.skipExcluded': true,
                    'explorerFileNav.wrap': true,
                    'explorerFileNav.maxDepth': 30,
                    'explorerFileNav.showTiming': true,
                };
                const k = section + '.' + key;
                return k in table ? table[k] : def;
            },
            inspect: () => undefined,
        }),
        fs: {
            async readDirectory(uri) {
                const ents = fs.readdirSync(uri.fsPath, { withFileTypes: true });
                return ents.map((e) => {
                    let t = e.isDirectory() ? FT.Directory : FT.File;
                    if (e.isSymbolicLink()) t |= FT.SymbolicLink;
                    return [e.name, t];
                });
            },
            async stat(uri) {
                const s = fs.statSync(uri.fsPath);
                return { type: s.isDirectory() ? FT.Directory : FT.File, mtime: s.mtimeMs, ctime: s.birthtimeMs, size: s.size };
            },
        },
    },
    window: {
        activeTextEditor: null,
        tabGroups: { activeTabGroup: { activeTab: null } },
        onDidChangeActiveTextEditor: () => ({ dispose() { } }),
        showTextDocument: async (uri) => { RESULT.opened = uri.fsPath; },
        showInformationMessage: (m) => { RESULT.info = m; },
        showErrorMessage: (m) => { RESULT.error = m; },
        setStatusBarMessage: (m) => { RESULT.status = m; },
    },
    commands: {
        registerCommand: (id, fn) => { HANDLERS[id] = fn; },
        executeCommand: async (id, ...args) => {
            if (id === 'vscode.openWith') {
                RESULT.opened = args[0].fsPath;
                RESULT.openedWith = 'openWith:' + args[1];
            }
            if (id === 'vscode.open') {
                RESULT.opened = args[0].fsPath;
                RESULT.openedWith = 'vscode.open（默认方式）';
            }
        },
    },
};

const RESULT = {};
const HANDLERS = {};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return mockVscode;
    return origLoad.apply(this, arguments);
};

const startFile = path.resolve(process.argv[2]);
const direction = process.argv[3] === 'prev' ? 'previous' : 'next';

if (process.argv[5] === 'preview') {
    mockVscode.window.activeTextEditor = null;
    mockVscode.window.tabGroups.activeTabGroup.activeTab = {
        input: new TabInputCustom(toUri(startFile), process.argv[6] || 'markdown-preview-enhanced'),
    };
} else {
    mockVscode.window.activeTextEditor = { document: { uri: toUri(startFile) } };
}

const ext = require(path.join(__dirname, '..', 'src', 'extension.js'));
ext.activate({ subscriptions: [] });

(async () => {
    const t0 = Date.now();
    await HANDLERS['explorerFileNav.' + direction]();
    const ms = Date.now() - t0;

    console.log('sortOrder      :', SORT_ORDER);
    console.log('起始文件        :', startFile);
    console.log('方向            :', direction === 'next' ? '下一个' : '上一个');
    console.log('结果            :', RESULT.opened || ('(无) ' + (RESULT.status || RESULT.info || '')));
    if (RESULT.openedWith) console.log('打开方式        :', RESULT.openedWith);
    console.log('耗时            :', ms, 'ms');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
