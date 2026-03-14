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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const JarFileSystem_1 = require("./JarFileSystem");
const JarTreeProvider_1 = require("./JarTreeProvider");
const JarBackend_1 = require("./JarBackend");
function activate(context) {
    const fsProvider = new JarFileSystem_1.JarFileSystemProvider(context.extensionPath);
    const treeProvider = new JarTreeProvider_1.JarTreeProvider();
    // Register virtual read-only filesystem
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider(JarFileSystem_1.JAR_SCHEME, fsProvider, {
        isReadonly: true,
        isCaseSensitive: true
    }));
    // Sidebar panel "JAR Contents"
    const treeView = vscode.window.createTreeView('jarContents', {
        treeDataProvider: treeProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(treeView);
    // Command: Open JAR File
    context.subscriptions.push(vscode.commands.registerCommand('jarDecompiler.openJar', async (uri) => {
        let target = uri;
        if (!target) {
            const files = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectMany: false,
                filters: { 'Java Archives': ['jar', 'war', 'zip'] },
                title: 'Select JAR file to decompile'
            });
            if (!files?.[0])
                return;
            target = files[0];
        }
        await loadJar(target.fsPath, treeProvider, fsProvider, context);
    }));
    // Command: Set Decompiler
    context.subscriptions.push(vscode.commands.registerCommand('jarDecompiler.setDecompiler', async () => {
        const options = ['CFR', 'VINEFLOWER'];
        const current = vscode.workspace.getConfiguration('jarDecompiler')
            .get('decompiler', 'CFR');
        const picked = await vscode.window.showQuickPick(options, {
            title: 'Select Decompiler Backend',
            placeHolder: `Current: ${current}`
        });
        if (!picked)
            return;
        await vscode.workspace.getConfiguration('jarDecompiler')
            .update('decompiler', picked, vscode.ConfigurationTarget.Global);
        fsProvider.clearCache();
        vscode.window.showInformationMessage(`Decompiler set to ${picked}`);
    }));
    // Intercept drag-and-drop / normal .jar file opening
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(async (doc) => {
        if (doc.uri.scheme !== 'file')
            return;
        if (!/\.(jar|war|zip)$/i.test(doc.fileName))
            return;
        // Close the binary document and open as virtual JAR
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        await loadJar(doc.fileName, treeProvider, fsProvider, context);
    }));
    context.subscriptions.push({ dispose: JarBackend_1.disposeBackend });
}
async function loadJar(jarPath, treeProvider, fsProvider, context) {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Loading ${path.basename(jarPath)}…`,
        cancellable: false
    }, async () => {
        try {
            const backend = (0, JarBackend_1.getBackend)(context.extensionPath);
            const entries = await backend.listEntries(jarPath);
            treeProvider.setJar(jarPath, entries);
            fsProvider.clearCache(jarPath);
            await vscode.commands.executeCommand('setContext', 'jarDecompiler.jarLoaded', true);
            await vscode.commands.executeCommand('jarContents.focus');
            vscode.window.showInformationMessage(`${path.basename(jarPath)} — ${entries.filter(e => !e.directory).length} files`);
        }
        catch (err) {
            vscode.window.showErrorMessage(`JAR Decompiler: ${err.message}`);
        }
    });
}
function deactivate() {
    (0, JarBackend_1.disposeBackend)();
}
//# sourceMappingURL=extension.js.map