export interface JarEntryInfo {
    path: string;
    directory: boolean;
    size: number;
}

export type DecompilerBackend = 'PROCYON' | 'CFR' | 'VINEFLOWER';

// Responses from the Java CLI
export type CliResponse =
    | { ready: true }
    | { id: number; ok: true;  entries: JarEntryInfo[] }
    | { id: number; ok: true;  source: string }
    | { id: number; ok: true;  data: string }
    | { id: number; ok: true;  pong: true }
    | { id: number; ok: false; error: string };
