import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
import { CliResponse, JarEntryInfo, DecompilerBackend } from './types';

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export class JarBackend implements vscode.Disposable {
    private proc: cp.ChildProcess | undefined;
    private pending = new Map<number, Pending>();
    private nextId = 1;
    private readyPromise: Promise<void>;
    private readyResolve!: () => void;

    constructor(private readonly jarPath: string) {
        this.readyPromise = new Promise(r => { this.readyResolve = r; });
        this.spawn();
    }

    private spawn(): void {
        const config = vscode.workspace.getConfiguration('jarDecompiler');
        const java = config.get<string>('javaPath', 'java');

        this.proc = cp.spawn(java, ['-jar', this.jarPath], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        readline.createInterface({ input: this.proc.stdout! }).on('line', line => {
            try {
                const msg = JSON.parse(line) as CliResponse;
                if ('ready' in msg) { this.readyResolve(); return; }
                const p = this.pending.get((msg as any).id);
                if (!p) return;
                this.pending.delete((msg as any).id);
                (msg as any).ok ? p.resolve(msg) : p.reject(new Error((msg as any).error));
            } catch { /* ignore malformed lines */ }
        });

        this.proc.on('error', err => {
            for (const p of this.pending.values()) p.reject(err);
            this.pending.clear();
        });
    }

    private async send<T>(payload: object): Promise<T> {
        await this.readyPromise;
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.proc!.stdin!.write(JSON.stringify({ id, ...payload }) + '\n');
        });
    }

    async listEntries(jarFilePath: string): Promise<JarEntryInfo[]> {
        const r = await this.send<{ ok: true; entries: JarEntryInfo[] }>({ cmd: 'list', jar: jarFilePath });
        return r.entries;
    }

    async decompile(jarFilePath: string, entry: string, backend: DecompilerBackend): Promise<string> {
        const r = await this.send<{ ok: true; source: string }>({ cmd: 'decompile', jar: jarFilePath, entry, backend });
        return r.source;
    }

    async readRaw(jarFilePath: string, entry: string): Promise<Buffer> {
        const r = await this.send<{ ok: true; data: string }>({ cmd: 'read', jar: jarFilePath, entry });
        return Buffer.from(r.data, 'base64');
    }

    dispose(): void { this.proc?.kill(); }
}

let _instance: JarBackend | undefined;

export function getBackend(extensionPath: string): JarBackend {
    if (!_instance) {
        const jar = path.join(extensionPath, 'resources', 'decompiler-backend.jar');
        _instance = new JarBackend(jar);
    }
    return _instance;
}

export function disposeBackend(): void {
    _instance?.dispose();
    _instance = undefined;
}
