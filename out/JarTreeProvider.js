"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.JarTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
const JarFileSystem_1 = require("./JarFileSystem");
function buildTree(entries, jarPath) {
    const root = { label: '', fullPath: '', isDir: true, children: [], jarPath };
    for (const e of entries) {
        const parts = e.path.replace(/\/$/, '').split('/');
        let cur = root;
        for (let i = 0; i < parts.length; i++) {
            const label = parts[i];
            const isLast = i === parts.length - 1;
            let child = cur.children.find(c => c.label === label);
            if (!child) {
                child = {
                    label,
                    fullPath: parts.slice(0, i + 1).join('/') + (isLast && e.directory ? '/' : ''),
                    isDir: isLast ? e.directory : true,
                    children: [],
                    jarPath
                };
                cur.children.push(child);
            }
            cur = child;
        }
    }
    sort(root);
    return root.children;
}
function sort(n) {
    n.children.sort((a, b) => {
        if (a.isDir !== b.isDir)
            return a.isDir ? -1 : 1;
        return a.label.localeCompare(b.label);
    });
    n.children.forEach(sort);
}
function icon(n) {
    if (n.isDir)
        return new vscode.ThemeIcon('folder');
    if (n.label.endsWith('.class'))
        return new vscode.ThemeIcon('symbol-class');
    if (n.label === 'MANIFEST.MF')
        return new vscode.ThemeIcon('info');
    if (/\.(png|jpg|gif|ico|svg|bmp)$/i.test(n.label))
        return new vscode.ThemeIcon('file-media');
    if (/\.(xml|json|yaml|yml|properties)$/i.test(n.label))
        return new vscode.ThemeIcon('file-code');
    return new vscode.ThemeIcon('file');
}
class JarTreeProvider {
    constructor() {
        this._change = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._change.event;
        this.roots = [];
    }
    setJar(jarPath, entries) {
        this.roots = buildTree(entries, jarPath);
        this._change.fire();
    }
    clear() { this.roots = []; this._change.fire(); }
    getTreeItem(n) {
        const item = new vscode.TreeItem(n.label, n.isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        item.iconPath = icon(n);
        if (!n.isDir) {
            const uri = (0, JarFileSystem_1.buildUri)(n.jarPath, n.fullPath);
            item.command = { command: 'vscode.open', title: 'Open', arguments: [uri] };
            item.resourceUri = uri;
            item.tooltip = n.fullPath;
        }
        return item;
    }
    getChildren(n) {
        return n ? n.children : this.roots;
    }
}
exports.JarTreeProvider = JarTreeProvider;
//# sourceMappingURL=JarTreeProvider.js.map