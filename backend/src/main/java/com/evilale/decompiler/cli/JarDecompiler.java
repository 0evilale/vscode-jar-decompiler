package com.evilale.decompiler.cli;

import org.benf.cfr.reader.api.CfrDriver;
import org.benf.cfr.reader.api.ClassFileSource;
import org.benf.cfr.reader.api.OutputSinkFactory;
import org.benf.cfr.reader.bytecode.analysis.parse.utils.Pair;
import org.benf.cfr.reader.util.getopt.OptionsImpl;

import org.jetbrains.java.decompiler.main.Fernflower;
import org.jetbrains.java.decompiler.main.extern.IBytecodeProvider;
import org.jetbrains.java.decompiler.main.extern.IFernflowerLogger;
import org.jetbrains.java.decompiler.main.extern.IFernflowerLogger.Severity;
import org.jetbrains.java.decompiler.main.extern.IResultSaver;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.jar.Manifest;

public class JarDecompiler {

    public enum Backend { CFR, VINEFLOWER }

    public static String decompile(String jarPath, String entryPath, Backend backend) throws Exception {
        byte[] classBytes = readEntry(jarPath, entryPath);
        if (backend == Backend.VINEFLOWER) {
            return decompileWithVineflower(classBytes, entryPath, jarPath);
        }
        // CFR with automatic fallback to Vineflower on failure
        try {
            return decompileWithCfr(classBytes, entryPath);
        } catch (Throwable cfrError) {
            try {
                return decompileWithVineflower(classBytes, entryPath, jarPath);
            } catch (Throwable vfError) {
                String msg = cfrError.getClass().getSimpleName();
                if (cfrError.getMessage() != null) msg += ": " + cfrError.getMessage();
                throw new RuntimeException("Decompilation failed (CFR + Vineflower): " + msg);
            }
        }
    }

    public static byte[] readRaw(String jarPath, String entryPath) throws Exception {
        return readEntry(jarPath, entryPath);
    }

    // -------------------------------------------------------------------------
    // CFR backend
    // -------------------------------------------------------------------------

    private static String decompileWithCfr(byte[] classBytes, String entryPath) {
        Map<String, String> options = Map.of(
            OptionsImpl.SHOW_CFR_VERSION.getName(), "false",
            OptionsImpl.DECOMPILE_INNER_CLASSES.getName(), "false"
        );
        StringBuilder result = new StringBuilder();

        ClassFileSource source = new ClassFileSource() {
            @Override public Pair<byte[], String> getClassFileContent(String path) {
                return Pair.make(classBytes, entryPath);
            }
            @Override public String getPossiblyRenamedPath(String path) { return path; }
            @Override public void informAnalysisRelativePathDetail(String u, String c) {}
            @Override public Collection<String> addJar(String jarPath) { return null; }
        };

        OutputSinkFactory sink = new OutputSinkFactory() {
            @Override
            public List<SinkClass> getSupportedSinks(SinkType t, Collection<SinkClass> a) {
                return List.of(SinkClass.STRING);
            }
            @Override
            public <T> Sink<T> getSink(SinkType t, SinkClass c) {
                return (Sink<T>) (Sink<String>) s -> result.append(s);
            }
        };

        new CfrDriver.Builder()
            .withClassFileSource(source)
            .withOutputSink(sink)
            .withOptions(options)
            .build()
            .analyse(List.of(entryPath));

        String out = result.toString().trim();
        if (out.startsWith("/")) {
            int nl = out.indexOf('\n');
            if (nl > 0) out = out.substring(nl + 1).trim();
        }
        return out;
    }

    // -------------------------------------------------------------------------
    // Vineflower backend
    // -------------------------------------------------------------------------

    private static String decompileWithVineflower(byte[] classBytes, String entryPath, String jarPath) throws Exception {
        // Write just this one .class file to a temp directory so Vineflower doesn't
        // scan the entire JAR (which causes StackOverflowError on large/complex JARs).
        Path tempDir = Files.createTempDirectory("vf-decompile-");
        try {
            Path classFile = tempDir.resolve(entryPath);
            Files.createDirectories(classFile.getParent());
            Files.write(classFile, classBytes);

            final String[] resultHolder = { null };

            IBytecodeProvider bytecodeProvider = (externalPath, internalPath) ->
                Files.readAllBytes(Path.of(externalPath));

            IResultSaver resultSaver = new IResultSaver() {
                @Override public void saveFolder(String path) {}
                @Override public void copyFile(String source, String path, String entryName) {}
                @Override public void saveClassFile(String path, String qualifiedName, String entryName,
                                                    String content, int[] mapping) {
                    resultHolder[0] = content;
                }
                @Override public void createArchive(String path, String archiveName, Manifest manifest) {}
                @Override public void saveDirEntry(String path, String archiveName, String entryName) {}
                @Override public void copyEntry(String source, String path, String archiveName, String entry) {}
                @Override public void saveClassEntry(String path, String archiveName, String qualifiedName,
                                                     String entryName, String content) {
                    resultHolder[0] = content;
                }
                @Override public void closeArchive(String path, String archiveName) {}
            };

            IFernflowerLogger logger = new IFernflowerLogger() {
                @Override public void writeMessage(String message, Severity severity) {}
                @Override public void writeMessage(String message, Severity severity, Throwable t) {}
            };

            Map<String, Object> options = new HashMap<>();
            options.put("ban", "0");

            Fernflower fernflower = new Fernflower(bytecodeProvider, resultSaver, options, logger);
            try {
                fernflower.addSource(classFile.toFile());
                fernflower.decompileContext();
            } finally {
                fernflower.clearContext();
            }

            if (resultHolder[0] != null) {
                return resultHolder[0].trim();
            }
            return decompileWithCfr(classBytes, entryPath);
        } finally {
            deleteRecursive(tempDir);
        }
    }

    private static void deleteRecursive(Path dir) {
        try {
            Files.walk(dir)
                .sorted(Comparator.reverseOrder())
                .forEach(p -> { try { Files.delete(p); } catch (IOException ignored) {} });
        } catch (IOException ignored) {}
    }

    // -------------------------------------------------------------------------
    // Shared helpers
    // -------------------------------------------------------------------------

    private static byte[] readEntry(String jarPath, String entryPath) throws Exception {
        try (JarFile jar = new JarFile(new File(jarPath))) {
            JarEntry entry = jar.getJarEntry(entryPath);
            if (entry == null) throw new IllegalArgumentException("Entry not found: " + entryPath);
            return jar.getInputStream(entry).readAllBytes();
        }
    }
}
