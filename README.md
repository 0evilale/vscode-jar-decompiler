# JAR Decompiler

Browse and decompile Java `.jar` files directly inside VS Code. Open any class file and read its source instantly — with full editor features like syntax highlighting, go to definition, and search.

## Features

- **Browse JAR contents** — tree view showing all packages, classes, and resources
- **Decompile on demand** — click any `.class` file to open it as readable Java source
- **Two decompiler backends** — CFR (fast, default) and Vineflower (better output for complex code)
- **Automatic fallback** — if CFR fails on a complex class, Vineflower is tried automatically
- **Read non-class resources** — view `.properties`, `.xml`, `.MF`, and other files inside the JAR

## Usage

1. Right-click a `.jar` file in the Explorer and choose **Open JAR File**
2. The **JAR Contents** panel opens in the sidebar
3. Click any `.class` entry to decompile and view the source

You can also use the command palette: `JAR Decompiler: Open JAR File`.

## Switching decompiler

Click the settings icon in the JAR Contents panel title bar, or open the command palette and run **JAR Decompiler: Set Decompiler** to toggle between CFR and Vineflower.

You can also set the default in settings:

```json
"jarDecompiler.decompiler": "CFR"   // or "VINEFLOWER"
```

## Requirements

- **Java 11 or newer** must be installed and accessible.
- By default the extension uses `java` from your `PATH`. You can override this in settings:

```json
"jarDecompiler.javaPath": "/path/to/java"
```

### WSL users

If you are running VS Code on Windows with the extension installed in WSL, set `javaPath` to the full Linux path of the Java binary, for example:

```json
"jarDecompiler.javaPath": "/home/user/.sdkman/candidates/java/current/bin/java"
```

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `jarDecompiler.javaPath` | `java` | Path to the Java executable |
| `jarDecompiler.decompiler` | `CFR` | Decompiler backend (`CFR` or `VINEFLOWER`) |

## Decompiler backends

| Backend | Speed | Notes |
|---|---|---|
| **CFR** | Fast | Default. Works well for most classes. |
| **Vineflower** | Slower | Better output for lambdas and complex code. Used as automatic fallback when CFR fails. |

## Known limitations

- Decompiled output is read-only
- Highly obfuscated classes may not decompile cleanly

## License

MIT
