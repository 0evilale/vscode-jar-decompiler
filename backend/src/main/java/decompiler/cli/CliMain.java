package decompiler.cli;

import com.google.gson.*;
import java.io.*;
import java.util.Base64;
import java.util.List;

public class CliMain {

    public static void main(String[] args) throws Exception {
        // Silence decompiler stderr so it doesn't pollute the JSON protocol
        System.setErr(new PrintStream(OutputStream.nullOutputStream()));

        Gson gson = new Gson();
        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));
        PrintWriter out = new PrintWriter(new BufferedWriter(new OutputStreamWriter(System.out)));

        // Ready signal
        out.println("{\"ready\":true}");
        out.flush();

        String line;
        while ((line = reader.readLine()) != null) {
            JsonObject cmd;
            try {
                cmd = JsonParser.parseString(line).getAsJsonObject();
            } catch (Exception e) {
                out.println("{\"ok\":false,\"error\":\"invalid JSON\"}");
                out.flush();
                continue;
            }

            long id = cmd.has("id") ? cmd.get("id").getAsLong() : 0;
            String response;
            try {
                response = handle(cmd, id, gson);
            } catch (Exception e) {
                String msg = gson.toJson(e.getMessage() != null ? e.getMessage() : "unknown error");
                response = String.format("{\"id\":%d,\"ok\":false,\"error\":%s}", id, msg);
            }

            out.println(response);
            out.flush();
        }
    }

    private static String handle(JsonObject cmd, long id, Gson gson) throws Exception {
        String command = cmd.get("cmd").getAsString();
        return switch (command) {
            case "list" -> {
                String jar = cmd.get("jar").getAsString();
                List<JarLister.EntryInfo> entries = JarLister.list(jar);
                yield String.format("{\"id\":%d,\"ok\":true,\"entries\":%s}", id, gson.toJson(entries));
            }
            case "decompile" -> {
                String jar = cmd.get("jar").getAsString();
                String entry = cmd.get("entry").getAsString();
                String backendName = cmd.has("backend") ? cmd.get("backend").getAsString() : "CFR";
                JarDecompiler.Backend backend = parseBackend(backendName);
                String source = JarDecompiler.decompile(jar, entry, backend);
                yield String.format("{\"id\":%d,\"ok\":true,\"source\":%s}", id, gson.toJson(source));
            }
            case "read" -> {
                String jar = cmd.get("jar").getAsString();
                String entry = cmd.get("entry").getAsString();
                byte[] data = JarDecompiler.readRaw(jar, entry);
                String b64 = Base64.getEncoder().encodeToString(data);
                yield String.format("{\"id\":%d,\"ok\":true,\"data\":\"%s\"}", id, b64);
            }
            case "ping" -> String.format("{\"id\":%d,\"ok\":true,\"pong\":true}", id);
            default -> String.format("{\"id\":%d,\"ok\":false,\"error\":\"unknown command: %s\"}", id, command);
        };
    }

    private static JarDecompiler.Backend parseBackend(String name) {
        return switch (name.toUpperCase()) {
            case "VINEFLOWER" -> JarDecompiler.Backend.VINEFLOWER;
            default -> JarDecompiler.Backend.CFR;
        };
    }
}
