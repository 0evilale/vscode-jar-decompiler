# Design: Add Procyon Decompiler with Generic Fallback Chain

**Date:** 2026-03-22
**Status:** Approved

---

## Summary

Add Procyon as a third decompiler backend and replace the current hardcoded CFR→Vineflower fallback logic with a generic fallback chain system. Procyon becomes the new default. CFR is the universal last resort.

---

## Architecture

The change touches 6 files across two layers: the Java backend and the TypeScript extension.

### Fallback chains per selected backend

| Selected backend | Attempt order              |
|------------------|---------------------------|
| PROCYON          | Procyon → Vineflower → CFR |
| VINEFLOWER       | Vineflower → CFR           |
| CFR              | CFR                        |

A single generic method `decompileWithFallback(bytes, entry, jar, List<Backend>)` iterates the chain and throws only if every backend fails.

---

## Components

### 1. `backend/build.gradle.kts`

Add the Procyon decompiler dependency (correct Maven coordinates on Central):

```kotlin
implementation("org.bitbucket.mstrobel:procyon-compilertools:0.6.0")
```

`procyon-core` and `procyon-expressions` are pulled in transitively.

### 2. `backend/src/main/java/com/evilale/decompiler/cli/JarDecompiler.java`

**a) Enum** — add `PROCYON` to `Backend`.

**b) `decompileWithProcyon(byte[] classBytes, String entryPath): String`**

Procyon's API works via class name resolution, not raw bytes directly. The `ITypeLoader` interface method is `boolean tryLoadType(String internalName, Buffer buffer)` where `Buffer` is `com.strobel.core.Buffer`. The call sequence:

```java
// internalName = entryPath without ".class" suffix, e.g. "com/example/Foo"
String internalName = entryPath.endsWith(".class")
    ? entryPath.substring(0, entryPath.length() - 6)
    : entryPath;

DecompilerSettings settings = DecompilerSettings.javaDefaults();
settings.setShowSyntheticMembers(false);

ITypeLoader loader = (name, buffer) -> {
    buffer.putByteArray(classBytes, 0, classBytes.length);
    buffer.position(0);
    return true;
};

StringWriter writer = new StringWriter();
settings.setWriter(new PlainTextOutput(writer));

ClassFileDecompiler.decompile(internalName, loader, settings);

String result = writer.toString().trim();
if (result.isEmpty()) {
    throw new RuntimeException("Procyon produced no output");
}
return result;
```

The empty-output guard ensures the fallback chain triggers correctly if Procyon silently produces nothing instead of throwing.

**c) Silent no-output fallback in `decompileWithVineflower`** — the current implementation at line 149 silently falls back to CFR when Vineflower produces no output:

```java
if (resultHolder[0] != null) {
    return resultHolder[0].trim();
}
return decompileWithCfr(classBytes, entryPath);  // ← must be removed
```

This must be replaced with a `throw new RuntimeException("Vineflower produced no output")` so that `decompileWithFallback` controls all routing and the PROCYON→VF→CFR chain behaves correctly.

**d) `decompileWithFallback(byte[] bytes, String entry, String jar, List<Backend> chain): String`**

```java
private static String decompileWithFallback(byte[] bytes, String entry, String jar, List<Backend> chain) throws Exception {
    List<String> errors = new ArrayList<>();
    for (Backend b : chain) {
        try {
            return switch (b) {
                case PROCYON    -> decompileWithProcyon(bytes, entry);
                case VINEFLOWER -> decompileWithVineflower(bytes, entry, jar);
                case CFR        -> decompileWithCfr(bytes, entry);
            };
        } catch (Throwable t) {
            String msg = b.name() + ": " + t.getClass().getSimpleName();
            if (t.getMessage() != null) msg += ": " + t.getMessage();
            errors.add(msg);
        }
    }
    throw new RuntimeException("Decompilation failed: " + String.join("; ", errors));
}
```

**e) `decompile()` public method** — full replacement (the `readEntry` call must be preserved before building the chain):

```java
public static String decompile(String jarPath, String entryPath, Backend backend) throws Exception {
    byte[] classBytes = readEntry(jarPath, entryPath);
    List<Backend> chain = switch (backend) {
        case PROCYON    -> List.of(Backend.PROCYON, Backend.VINEFLOWER, Backend.CFR);
        case VINEFLOWER -> List.of(Backend.VINEFLOWER, Backend.CFR);
        case CFR        -> List.of(Backend.CFR);
    };
    return decompileWithFallback(classBytes, entryPath, jarPath, chain);
}
```

### 3. `backend/src/main/java/com/evilale/decompiler/cli/CliMain.java`

Two changes:

1. Add `"PROCYON"` case to `parseBackend()` and replace the silent `default -> Backend.CFR` with an explicit error:
2. Update the absent-field default on the `"decompile"` case (currently `"CFR"`, must match new default) to `"PROCYON"`:
   ```java
   String backendName = cmd.has("backend") ? cmd.get("backend").getAsString() : "PROCYON";
   ```

```java
private static Backend parseBackend(String name) {
    return switch (name.toUpperCase()) {
        case "PROCYON"    -> JarDecompiler.Backend.PROCYON;
        case "VINEFLOWER" -> JarDecompiler.Backend.VINEFLOWER;
        case "CFR"        -> JarDecompiler.Backend.CFR;
        default -> throw new IllegalArgumentException("Unknown backend: " + name);
    };
}
```

### 4. `src/types.ts`

```typescript
export type DecompilerBackend = 'CFR' | 'VINEFLOWER' | 'PROCYON';
```

### 5. `src/extension.ts`

Two changes:

1. Add `'PROCYON'` to the QuickPick options array:
   ```typescript
   const options: DecompilerBackend[] = ['PROCYON', 'CFR', 'VINEFLOWER'];
   ```
2. Change the hardcoded default string in the `.get<string>` call (line 50) from `'CFR'` to `'PROCYON'`:
   ```typescript
   const current = vscode.workspace.getConfiguration('jarDecompiler')
       .get<string>('decompiler', 'PROCYON');
   ```

### 6. `package.json`

Two changes:

1. Add `"PROCYON"` to the `enum` array of `jarDecompiler.decompiler`.
2. Change `"default"` from `"CFR"` to `"PROCYON"`.

Both must be updated together: `package.json` governs fresh installs, the `extension.ts` literal governs runtime fallback. Updating only one creates an inconsistency.

---

## Data Flow

```
User selects backend (e.g. PROCYON)
  → TS sends { cmd: "decompile", backend: "PROCYON", ... }
  → Java CliMain.parseBackend("PROCYON") → Backend.PROCYON
  → JarDecompiler.decompile() builds chain [PROCYON, VINEFLOWER, CFR]
  → decompileWithFallback() tries each in order
  → Returns first success or throws aggregated error
```

---

## Error Handling

- Each backend attempt catches `Throwable` independently within `decompileWithFallback`.
- If all fail, the thrown message lists which backends were tried and each error, e.g.:
  `"Decompilation failed: PROCYON: <err1>; VINEFLOWER: <err2>; CFR: <err3>"`
- Unknown backend strings throw `IllegalArgumentException` at the protocol layer rather than silently defaulting to CFR.
- The timeout and stack-size protections in `CliMain` remain unchanged.

---

## Testing

- Manually test each backend via the QuickPick command.
- Verify default is PROCYON in fresh install (check `package.json` default) and at runtime.
- Verify VINEFLOWER falls back to CFR on a deliberately broken class.
- Verify PROCYON falls through all three on failure and the error message lists all three backends.
- Verify an unknown backend string returns `ok: false` with a descriptive error.
- Verify Procyon empty-output case triggers the fallback chain (VINEFLOWER attempted next).

---

## Out of Scope

- No UI changes beyond adding PROCYON to the picker and changing the default.
- No changes to the JAR listing, raw read, or ping commands.
- No changes to timeout or thread pool logic.
