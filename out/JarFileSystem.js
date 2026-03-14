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
exports.JarFileSystemProvider = exports.JAR_SCHEME = void 0;
exports.buildUri = buildUri;
exports.parseUri = parseUri;
const vscode = __importStar(require("vscode"));
const JarBackend_1 = require("./JarBackend");
exports.JAR_SCHEME = 'jar-decompiled';
/** Builds URI for an entry inside a JAR. */
function buildUri(jarPath, entryPath) {
    const displayPath = entryPath.endsWith('.class')
        ? entryPath.slice(0, -6) + '.java'
        : entryPath;
    return vscode.Uri.from({ scheme: exports.JAR_SCHEME, path: `${jarPath}!/${displayPath}` });
}
/** Parses jarPath and entryPath from a jar-decompiled URI. */
function parseUri(uri) {
    const raw = uri.path;
    const sep = raw.indexOf('!/');
    if (sep === -1)
        throw new Error(`Invalid URI: ${uri}`);
    const jarPath = raw.slice(0, sep);
    const displayEntry = raw.slice(sep + 2);
    // Convert .java → .class to look up in the JAR
    const entryPath = displayEntry.endsWith('.java')
        ? displayEntry.slice(0, -5) + '.class'
        : displayEntry;
    return { jarPath, entryPath };
}
class JarFileSystemProvider {
    constructor(extensionPath) {
        this.extensionPath = extensionPath;
        this.cache = new Map();
        this._emitter = new vscode.EventEmitter();
        this.onDidChangeFile = this._emitter.event;
    }
    watch() { return new vscode.Disposable(() => { }); }
    stat(uri) {
        return {
            type: vscode.FileType.File,
            ctime: 0, mtime: 0,
            size: this.cache.get(uri.toString())?.length ?? 0,
            permissions: vscode.FilePermission.Readonly
        };
    }
    readDirectory() { throw vscode.FileSystemError.NoPermissions(); }
    createDirectory() { throw vscode.FileSystemError.NoPermissions(); }
    writeFile() { throw vscode.FileSystemError.NoPermissions(); }
    delete() { throw vscode.FileSystemError.NoPermissions(); }
    rename() { throw vscode.FileSystemError.NoPermissions(); }
    async readFile(uri) {
        const key = uri.toString();
        if (this.cache.has(key))
            return this.cache.get(key);
        const { jarPath, entryPath } = parseUri(uri);
        const backend = (0, JarBackend_1.getBackend)(this.extensionPath);
        const config = vscode.workspace.getConfiguration('jarDecompiler');
        const decompiler = config.get('decompiler', 'CFR');
        let content;
        if (entryPath.endsWith('.class')) {
            const source = await backend.decompile(jarPath, entryPath, decompiler);
            content = Buffer.from(source, 'utf-8');
        }
        else {
            const buf = await backend.readRaw(jarPath, entryPath);
            content = new Uint8Array(buf);
        }
        this.cache.set(key, content);
        return content;
    }
    clearCache(jarPath) {
        if (!jarPath) {
            this.cache.clear();
            return;
        }
        for (const k of this.cache.keys())
            if (k.includes(jarPath))
                this.cache.delete(k);
    }
}
exports.JarFileSystemProvider = JarFileSystemProvider;
//# sourceMappingURL=JarFileSystem.js.map