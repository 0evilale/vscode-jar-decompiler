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

Add Procyon dependency:

```kotlin
implementation("org.procyon-decompiler:procyon-decompiler:0.6.0")
```

### 2. `backend/src/main/java/com/evilale/decompiler/cli/JarDecompiler.java`

- Add `PROCYON` to the `Backend` enum.
- Add `decompileWithProcyon(byte[] classBytes, String entryPath): String` private method using Procyon's `DecompilerSettings` and `ClassSource` API.
- Replace the existing hardcoded try/catch fallback in `decompile()` with a call to the new generic method.
- Add `decompileWithFallback(byte[] bytes, String entry, String jar, List<Backend> chain): String`:
  - Iterates `chain`, calls the corresponding `decompileWith*` method.
  - Catches `Throwable` per attempt and records errors.
  - If all fail, throws `RuntimeException` with a summary of all errors.
- Update `decompile()` to map backends to their chains and delegate to `decompileWithFallback`.

### 3. `backend/src/main/java/com/evilale/decompiler/cli/CliMain.java`

- Add `"PROCYON"` case to `parseBackend()` switch.

### 4. `src/types.ts`

```typescript
export type DecompilerBackend = 'CFR' | 'VINEFLOWER' | 'PROCYON';
```

### 5. `src/extension.ts`

- Add `'PROCYON'` to the QuickPick options array.
- Change the default fallback in `getConfiguration` from `'CFR'` to `'PROCYON'`.

### 6. `package.json`

- Add `"PROCYON"` to the `enum` array of `jarDecompiler.decompiler`.
- Change `"default"` from `"CFR"` to `"PROCYON"`.

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

- Each backend attempt catches `Throwable` independently.
- If all fail, the thrown message lists which backends were tried and each error, e.g.:
  `"Decompilation failed: PROCYON: <err1>; VINEFLOWER: <err2>; CFR: <err3>"`
- The timeout and stack-size protections in `CliMain` remain unchanged.

---

## Testing

- Manually test each backend via the QuickPick command.
- Verify default is now PROCYON in fresh install.
- Verify VINEFLOWER falls back to CFR on a deliberately broken class.
- Verify PROCYON falls through all three on failure.

---

## Out of Scope

- No UI changes beyond adding PROCYON to the picker and changing the default.
- No changes to the JAR listing, raw read, or ping commands.
- No changes to timeout or thread pool logic.
