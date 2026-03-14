package decompiler.cli;

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
import java.util.*;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.jar.Manifest;

public class JarDecompiler {

    public enum Backend { CFR, VINEFLOWER }

    public static String decompile(String jarPath, String entryPath, Backend backend) throws Exception {
        byte[] classBytes = readEntry(jarPath, entryPath);
        return switch (backend) {
            case CFR -> decompileWithCfr(classBytes, entryPath);
            case VINEFLOWER -> decompileWithVineflower(classBytes, entryPath, jarPath);
        };
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
        // Derive the simple class name from the entry path, e.g. "com/example/Foo.class" -> "Foo"
        String className = entryPath;
        if (className.contains("/")) {
            className = className.substring(className.lastIndexOf('/') + 1);
        }
        if (className.endsWith(".class")) {
            className = className.substring(0, className.length() - ".class".length());
        }
        final String targetClassName = className;

        // Result holder
        final String[] resultHolder = { null };

        // IBytecodeProvider: supplies class bytes when Vineflower asks for them
        IBytecodeProvider bytecodeProvider = (externalPath, internalPath) -> {
            // Vineflower calls this with the jar path and the internal entry path.
            // We intercept the specific class we want to decompile; everything else
            // is read from the JAR normally.
            if (internalPath != null && internalPath.equals(entryPath)) {
                return classBytes;
            }
            // Fall back: read from the JAR on disk
            try (JarFile jar = new JarFile(new File(externalPath))) {
                String lookup = (internalPath != null) ? internalPath : entryPath;
                JarEntry entry = jar.getJarEntry(lookup);
                if (entry == null) return new byte[0];
                return jar.getInputStream(entry).readAllBytes();
            } catch (IOException e) {
                return new byte[0];
            }
        };

        // IResultSaver: captures the decompiled source for our target class
        IResultSaver resultSaver = new IResultSaver() {
            @Override public void saveFolder(String path) {}
            @Override public void copyFile(String source, String path, String entryName) {}
            @Override public void saveClassFile(String path, String qualifiedName, String entryName,
                                                String content, int[] mapping) {
                // Called when decompiling individual .class files (non-JAR mode)
                if (entryName != null && entryName.contains(targetClassName)) {
                    resultHolder[0] = content;
                }
            }
            @Override public void createArchive(String path, String archiveName, Manifest manifest) {}
            @Override public void saveDirEntry(String path, String archiveName, String entryName) {}
            @Override public void copyEntry(String source, String path, String archiveName, String entry) {}
            @Override public void saveClassEntry(String path, String archiveName, String qualifiedName,
                                                 String entryName, String content) {
                // Called when decompiling entries from a JAR
                if (entryName != null && entryName.contains(targetClassName)) {
                    resultHolder[0] = content;
                }
            }
            @Override public void closeArchive(String path, String archiveName) {}
        };

        // Silent logger
        IFernflowerLogger logger = new IFernflowerLogger() {
            @Override public void writeMessage(String message, Severity severity) {}
            @Override public void writeMessage(String message, Severity severity, Throwable t) {}
        };

        Map<String, Object> options = new HashMap<>();
        // Suppress Vineflower version comment in output
        options.put("ban", "0");

        Fernflower fernflower = new Fernflower(bytecodeProvider, resultSaver, options, logger);
        try {
            fernflower.addSource(new File(jarPath));
            fernflower.addWhitelist(entryPath.replace('/', '.').replaceAll("\\.class$", ""));
            fernflower.decompileContext();
        } finally {
            fernflower.clearContext();
        }

        if (resultHolder[0] != null) {
            return resultHolder[0].trim();
        }
        // Fallback: Vineflower didn't produce output for this entry — use CFR
        return decompileWithCfr(classBytes, entryPath);
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
