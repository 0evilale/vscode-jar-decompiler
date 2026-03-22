import * as vscode from 'vscode';
import * as path from 'path';
import { JarFileSystemProvider, JAR_SCHEME } from './JarFileSystem';
import { JarTreeProvider } from './JarTreeProvider';
import { getBackend, disposeBackend } from './JarBackend';
import { DecompilerBackend } from './types';

export function activate(context: vscode.ExtensionContext): void {
    const fsProvider = new JarFileSystemProvider(context.extensionPath);
    const treeProvider = new JarTreeProvider();

    // Register virtual read-only filesystem
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider(JAR_SCHEME, fsProvider, {
            isReadonly: true,
            isCaseSensitive: true
        })
    );

    // Sidebar panel "JAR Contents"
    const treeView = vscode.window.createTreeView('jarContents', {
        treeDataProvider: treeProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(treeView);

    // Command: Open JAR File
    context.subscriptions.push(
        vscode.commands.registerCommand('jarDecompiler.openJar', async (uri?: vscode.Uri) => {
            let target = uri;
            if (!target) {
                const files = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectMany: false,
                    filters: { 'Java Archives': ['jar', 'war', 'zip'] },
                    title: 'Select JAR file to decompile'
                });
                if (!files?.[0]) return;
                target = files[0];
            }
            await loadJar(target.fsPath, treeProvider, fsProvider, context);
        })
    );

    // Command: Set Decompiler
    context.subscriptions.push(
        vscode.commands.registerCommand('jarDecompiler.setDecompiler', async () => {
            const options: DecompilerBackend[] = ['PROCYON', 'CFR', 'VINEFLOWER'];
            const current = vscode.workspace.getConfiguration('jarDecompiler')
                .get<string>('decompiler', 'PROCYON');
            const picked = await vscode.window.showQuickPick(options, {
                title: 'Select Decompiler Backend',
                placeHolder: `Current: ${current}`
            });
            if (!picked) return;
            await vscode.workspace.getConfiguration('jarDecompiler')
                .update('decompiler', picked, vscode.ConfigurationTarget.Global);
            fsProvider.clearCache();
            vscode.window.showInformationMessage(`Decompiler set to ${picked}`);
        })
    );

    // Intercept drag-and-drop / normal .jar file opening
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(async doc => {
            if (doc.uri.scheme !== 'file') return;
            if (!/\.(jar|war|zip)$/i.test(doc.fileName)) return;

            // Close the binary document and open as virtual JAR
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await loadJar(doc.fileName, treeProvider, fsProvider, context);
        })
    );

    context.subscriptions.push({ dispose: disposeBackend });
}

async function loadJar(
    jarPath: string,
    treeProvider: JarTreeProvider,
    fsProvider: JarFileSystemProvider,
    context: vscode.ExtensionContext
): Promise<void> {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Loading ${path.basename(jarPath)}…`,
        cancellable: false
    }, async () => {
        try {
            const backend = getBackend(context.extensionPath);
            const entries = await backend.listEntries(jarPath);

            treeProvider.setJar(jarPath, entries);
            fsProvider.clearCache(jarPath);

            await vscode.commands.executeCommand('setContext', 'jarDecompiler.jarLoaded', true);
            await vscode.commands.executeCommand('jarContents.focus');

            vscode.window.showInformationMessage(
                `${path.basename(jarPath)} — ${entries.filter(e => !e.directory).length} files`
            );
        } catch (err: any) {
            vscode.window.showErrorMessage(`JAR Decompiler: ${err.message}`);
        }
    });
}

export function deactivate(): void {
    disposeBackend();
}
