package decompiler.cli;

import java.io.File;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

public class JarLister {

    public record EntryInfo(String path, boolean directory, long size) {}

    public static List<EntryInfo> list(String jarPath) throws Exception {
        List<EntryInfo> result = new ArrayList<>();
        try (JarFile jar = new JarFile(new File(jarPath))) {
            Enumeration<JarEntry> entries = jar.entries();
            while (entries.hasMoreElements()) {
                JarEntry entry = entries.nextElement();
                result.add(new EntryInfo(entry.getName(), entry.isDirectory(), entry.getSize()));
            }
        }
        return result;
    }
}
