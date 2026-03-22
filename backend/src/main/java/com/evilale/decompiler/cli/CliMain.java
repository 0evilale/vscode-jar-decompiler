package com.evilale.decompiler.cli;

import com.evilale.decompiler.cli.JarDecompiler.Backend;
import com.google.gson.*;
import java.io.*;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.*;

public class CliMain {

    public static void main(String[] args) throws Exception {
        // Silence decompiler stderr so it doesn't pollute the JSON protocol
        System.setErr(new PrintStream(OutputStream.nullOutputStream()));

        Gson gson = new Gson();
        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));
        PrintWriter out = new PrintWriter(new BufferedWriter(new OutputStreamWriter(System.out)));
        // Serialize writes so JSON lines never interleave
        Object writeLock = new Object();
        // Thread pool: dispatches requests and enforces per-task timeouts.
        // Actual decompilation runs on daemon threads so hung threads never block the pool.
        ExecutorService executor = Executors.newFixedThreadPool(4);
        // Timeout for a single decompile/read task (must be < TypeScript's 60 s limit)
        final long TASK_TIMEOUT_MS = 30_000;

        // Ready signal
        out.println("{\"ready\":true}");
        out.flush();

        String line;
        while ((line = reader.readLine()) != null) {
            final String cmdLine = line;
            executor.submit(() -> {
                JsonObject cmd;
                try {
                    cmd = JsonParser.parseString(cmdLine).getAsJsonObject();
                } catch (Exception e) {
                    synchronized (writeLock) {
                        out.println("{\"ok\":false,\"error\":\"invalid JSON\"}");
                        out.flush();
                    }
                    return;
                }

                long id = cmd.has("id") ? cmd.get("id").getAsLong() : 0;

                // Run the actual work on a daemon thread so a hung decompiler
                // never permanently occupies a pool thread.
                // Large stack (32 MB) prevents StackOverflowError in CFR/Vineflower
                // when decompiling classes with deep recursion or complex bytecode.
                FutureTask<String> task = new FutureTask<>(() -> handle(cmd, id, gson));
                Thread worker = new Thread(null, task, "decompile-worker", 32 * 1024 * 1024L);
                worker.setDaemon(true);
                worker.start();

                String response;
                try {
                    response = task.get(TASK_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                } catch (TimeoutException e) {
                    worker.interrupt();
                    response = String.format(
                        "{\"id\":%d,\"ok\":false,\"error\":\"decompilation timed out after %ds\"}",
                        id, TASK_TIMEOUT_MS / 1000);
                } catch (ExecutionException e) {
                    Throwable cause = e.getCause();
                    String errorMsg;
                    if (cause != null) {
                        errorMsg = cause.getClass().getSimpleName();
                        if (cause.getMessage() != null) errorMsg += ": " + cause.getMessage();
                    } else {
                        errorMsg = "unknown error";
                    }
                    String msg = gson.toJson(errorMsg);
                    response = String.format("{\"id\":%d,\"ok\":false,\"error\":%s}", id, msg);
                } catch (Exception e) {
                    String msg = gson.toJson(e.getMessage() != null ? e.getMessage() : "unknown error");
                    response = String.format("{\"id\":%d,\"ok\":false,\"error\":%s}", id, msg);
                }

                synchronized (writeLock) {
                    out.println(response);
                    out.flush();
                }
            });
        }
        executor.shutdown();
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
                String backendName = cmd.has("backend") ? cmd.get("backend").getAsString() : "PROCYON";
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

    private static Backend parseBackend(String name) {
        return switch (name.toUpperCase()) {
            case "PROCYON"    -> JarDecompiler.Backend.PROCYON;
            case "VINEFLOWER" -> JarDecompiler.Backend.VINEFLOWER;
            case "CFR"        -> JarDecompiler.Backend.CFR;
            default -> throw new IllegalArgumentException("Unknown backend: " + name);
        };
    }
}
