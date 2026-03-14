import * as vscode from 'vscode';
import { JarEntryInfo } from './types';
import { buildUri } from './JarFileSystem';

interface TreeNode {
    label: string;
    fullPath: string;
    isDir: boolean;
    children: TreeNode[];
    jarPath: string;
}

function buildTree(entries: JarEntryInfo[], jarPath: string): TreeNode[] {
    const root: TreeNode = { label: '', fullPath: '', isDir: true, children: [], jarPath };
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

function sort(n: TreeNode): void {
    n.children.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.label.localeCompare(b.label);
    });
    n.children.forEach(sort);
}

function icon(n: TreeNode): vscode.ThemeIcon {
    if (n.isDir) return new vscode.ThemeIcon('folder');
    if (n.label.endsWith('.class')) return new vscode.ThemeIcon('symbol-class');
    if (n.label === 'MANIFEST.MF') return new vscode.ThemeIcon('info');
    if (/\.(png|jpg|gif|ico|svg|bmp)$/i.test(n.label)) return new vscode.ThemeIcon('file-media');
    if (/\.(xml|json|yaml|yml|properties)$/i.test(n.label)) return new vscode.ThemeIcon('file-code');
    return new vscode.ThemeIcon('file');
}

export class JarTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private _change = new vscode.EventEmitter<TreeNode | undefined | void>();
    readonly onDidChangeTreeData = this._change.event;
    private roots: TreeNode[] = [];

    setJar(jarPath: string, entries: JarEntryInfo[]): void {
        this.roots = buildTree(entries, jarPath);
        this._change.fire();
    }

    clear(): void { this.roots = []; this._change.fire(); }

    getTreeItem(n: TreeNode): vscode.TreeItem {
        const item = new vscode.TreeItem(
            n.label,
            n.isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );
        item.iconPath = icon(n);
        if (!n.isDir) {
            const uri = buildUri(n.jarPath, n.fullPath);
            item.command = { command: 'vscode.open', title: 'Open', arguments: [uri] };
            item.resourceUri = uri;
            item.tooltip = n.fullPath;
        }
        return item;
    }

    getChildren(n?: TreeNode): TreeNode[] {
        return n ? n.children : this.roots;
    }
}
