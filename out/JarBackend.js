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
exports.JarBackend = void 0;
exports.getBackend = getBackend;
exports.disposeBackend = disposeBackend;
const vscode = __importStar(require("vscode"));
const cp = __importStar(require("child_process"));
const path = __importStar(require("path"));
const readline = __importStar(require("readline"));
class JarBackend {
    constructor(jarPath) {
        this.jarPath = jarPath;
        this.pending = new Map();
        this.nextId = 1;
        this.readyPromise = new Promise((resolve, reject) => {
            this.readyResolve = resolve;
            this.readyReject = reject;
        });
        this.spawn();
    }
    /** Converts \\wsl.localhost\Distro\home\... → /home/... for use inside WSL commands */
    toWslPath(winPath) {
        const m = winPath.match(/^\\\\wsl[.$][^\\]+\\(.+)$/);
        return m ? '/' + m[1].replace(/\\/g, '/') : winPath;
    }
    spawn() {
        const config = vscode.workspace.getConfiguration('jarDecompiler');
        const javaPath = config.get('javaPath', 'java');
        const isWindows = process.platform === 'win32';
        let command;
        let args;
        if (isWindows) {
            // Extension host runs on Windows but Java is in WSL — use wsl interop
            const wslJar = this.toWslPath(this.jarPath);
            command = 'wsl';
            args = [javaPath, '-jar', wslJar];
        }
        else {
            command = javaPath;
            args = ['-jar', this.jarPath];
        }
        this.proc = cp.spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe']
        });
        // Timeout: if Java doesn't signal ready in 30s, fail clearly
        const timeout = setTimeout(() => {
            this.readyReject(new Error(`Java backend timed out. Check that Java is installed and '${javaPath}' is in PATH.\n` +
                `JAR: ${this.jarPath}`));
        }, 30000);
        readline.createInterface({ input: this.proc.stdout }).on('line', line => {
            try {
                const msg = JSON.parse(line);
                if ('ready' in msg) {
                    clearTimeout(timeout);
                    this.readyResolve();
                    return;
                }
                const p = this.pending.get(msg.id);
                if (!p)
                    return;
                this.pending.delete(msg.id);
                msg.ok ? p.resolve(msg) : p.reject(new Error(msg.error));
            }
            catch { /* ignore malformed lines */ }
        });
        this.proc.on('error', err => {
            clearTimeout(timeout);
            const error = new Error(`Failed to start Java: ${err.message}`);
            this.readyReject(error);
            for (const p of this.pending.values())
                p.reject(error);
            this.pending.clear();
            // Reset singleton so next call retries with updated settings
            if (_instance === this) {
                _instance = undefined;
            }
        });
        this.proc.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                const error = new Error(`Java process exited with code ${code}`);
                this.readyReject(error);
                if (_instance === this) {
                    _instance = undefined;
                }
            }
        });
    }
    async send(payload) {
        await this.readyPromise;
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.proc.stdin.write(JSON.stringify({ id, ...payload }) + '\n');
        });
    }
    async listEntries(jarFilePath) {
        const r = await this.send({ cmd: 'list', jar: jarFilePath });
        return r.entries;
    }
    async decompile(jarFilePath, entry, backend) {
        const r = await this.send({ cmd: 'decompile', jar: jarFilePath, entry, backend });
        return r.source;
    }
    async readRaw(jarFilePath, entry) {
        const r = await this.send({ cmd: 'read', jar: jarFilePath, entry });
        return Buffer.from(r.data, 'base64');
    }
    dispose() { this.proc?.kill(); }
}
exports.JarBackend = JarBackend;
let _instance;
function getBackend(extensionPath) {
    if (!_instance) {
        const jar = path.join(extensionPath, 'resources', 'decompiler-backend.jar');
        _instance = new JarBackend(jar);
    }
    return _instance;
}
function disposeBackend() {
    _instance?.dispose();
    _instance = undefined;
}
//# sourceMappingURL=JarBackend.js.map