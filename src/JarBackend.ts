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
    private readyReject!: (e: Error) => void;

    constructor(private readonly jarPath: string) {
        this.readyPromise = new Promise((resolve, reject) => {
            this.readyResolve = resolve;
            this.readyReject = reject;
        });
        this.spawn();
    }

    private spawn(): void {
        const config = vscode.workspace.getConfiguration('jarDecompiler');
        const java = config.get<string>('javaPath', 'java');

        this.proc = cp.spawn(java, ['-jar', this.jarPath], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // Timeout: if Java doesn't signal ready in 30s, fail clearly
        const timeout = setTimeout(() => {
            this.readyReject(new Error(
                `Java backend timed out. Check that Java is installed and '${java}' is in PATH.\n` +
                `JAR: ${this.jarPath}`
            ));
        }, 30000);

        readline.createInterface({ input: this.proc.stdout! }).on('line', line => {
            try {
                const msg = JSON.parse(line) as CliResponse;
                if ('ready' in msg) { clearTimeout(timeout); this.readyResolve(); return; }
                const p = this.pending.get((msg as any).id);
                if (!p) return;
                this.pending.delete((msg as any).id);
                (msg as any).ok ? p.resolve(msg) : p.reject(new Error((msg as any).error));
            } catch { /* ignore malformed lines */ }
        });

        this.proc.on('error', err => {
            clearTimeout(timeout);
            const error = new Error(`Failed to start Java: ${err.message}`);
            this.readyReject(error);
            for (const p of this.pending.values()) p.reject(error);
            this.pending.clear();
            // Reset singleton so next call retries with updated settings
            if (_instance === this) { _instance = undefined; }
        });

        this.proc.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                const error = new Error(`Java process exited with code ${code}`);
                this.readyReject(error);
                if (_instance === this) { _instance = undefined; }
            }
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
