import * as vscode from 'vscode';
import { getBackend } from './JarBackend';
import { DecompilerBackend } from './types';

export const JAR_SCHEME = 'jar-decompiled';

/** Builds URI for an entry inside a JAR. */
export function buildUri(jarPath: string, entryPath: string): vscode.Uri {
    const displayPath = entryPath.endsWith('.class')
        ? entryPath.slice(0, -6) + '.java'
        : entryPath;
    return vscode.Uri.from({ scheme: JAR_SCHEME, path: `${jarPath}!/${displayPath}` });
}

/** Parses jarPath and entryPath from a jar-decompiled URI. */
export function parseUri(uri: vscode.Uri): { jarPath: string; entryPath: string } {
    const raw = uri.path;
    const sep = raw.indexOf('!/');
    if (sep === -1) throw new Error(`Invalid URI: ${uri}`);
    const jarPath = raw.slice(0, sep);
    const displayEntry = raw.slice(sep + 2);
    // Convert .java → .class to look up in the JAR
    const entryPath = displayEntry.endsWith('.java')
        ? displayEntry.slice(0, -5) + '.class'
        : displayEntry;
    return { jarPath, entryPath };
}

export class JarFileSystemProvider implements vscode.FileSystemProvider {
    private cache = new Map<string, Uint8Array>();

    private readonly _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    constructor(private readonly extensionPath: string) {}

    watch(): vscode.Disposable { return new vscode.Disposable(() => {}); }

    stat(uri: vscode.Uri): vscode.FileStat {
        return {
            type: vscode.FileType.File,
            ctime: 0, mtime: 0,
            size: this.cache.get(uri.toString())?.length ?? 0,
            permissions: vscode.FilePermission.Readonly
        };
    }

    readDirectory(): never { throw vscode.FileSystemError.NoPermissions(); }
    createDirectory(): never { throw vscode.FileSystemError.NoPermissions(); }
    writeFile(): never { throw vscode.FileSystemError.NoPermissions(); }
    delete(): never { throw vscode.FileSystemError.NoPermissions(); }
    rename(): never { throw vscode.FileSystemError.NoPermissions(); }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const key = uri.toString();
        if (this.cache.has(key)) return this.cache.get(key)!;

        const { jarPath, entryPath } = parseUri(uri);
        const backend = getBackend(this.extensionPath);
        const config = vscode.workspace.getConfiguration('jarDecompiler');
        const decompiler = config.get<DecompilerBackend>('decompiler', 'CFR');

        let content: Uint8Array;
        if (entryPath.endsWith('.class')) {
            const source = await backend.decompile(jarPath, entryPath, decompiler);
            content = Buffer.from(source, 'utf-8');
        } else {
            const buf = await backend.readRaw(jarPath, entryPath);
            content = new Uint8Array(buf);
        }

        this.cache.set(key, content);
        return content;
    }

    clearCache(jarPath?: string): void {
        if (!jarPath) { this.cache.clear(); return; }
        for (const k of this.cache.keys()) if (k.includes(jarPath)) this.cache.delete(k);
    }
}
