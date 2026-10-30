// Windows transport only. State, authorization and deduplication stay in the receiver.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

internal static class HookRelay {
    static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16777216, RecursionLimit = 100 };
    static string Env(string key) { return Environment.GetEnvironmentVariable(key) ?? ""; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern uint GetFullPathName(string input, uint size, StringBuilder output, IntPtr filePart);
    static string ProfilePath(string profile) {
        // Match Node's lexical path.resolve. Framework Path.GetFullPath expands
        // existing 8.3 names, which changes the shared runtime directory hash.
        var buffer = new StringBuilder(32768);
        uint length = GetFullPathName(profile, (uint)buffer.Capacity, buffer, IntPtr.Zero);
        if (length == 0 || length >= buffer.Capacity) throw new IOException("Invalid profile path");
        string full = buffer.ToString();
        return full.Length > Path.GetPathRoot(full).Length ? full.TrimEnd('\\', '/') : full;
    }
    static string Root() {
        if (Env("AGENTDECK_RUNTIME_ROOT") != "") return Env("AGENTDECK_RUNTIME_ROOT");
        string accounts = Env("AGENTDECK_ACCOUNTS_FILE");
        if (accounts == "") accounts = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".agentdeck", "accounts.json");
        string root = Path.Combine(Path.GetDirectoryName(accounts), "runtime"), profile = Env("TABBY_CONFIG_DIRECTORY");
        if (profile != "") {
            string full = ProfilePath(profile);
            using (var sha = SHA256.Create()) root = Path.Combine(root, BitConverter.ToString(sha.ComputeHash(Utf8.GetBytes(full.ToLowerInvariant()))).Replace("-", "").ToLowerInvariant().Substring(0, 16));
        }
        return root;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
        public IntPtr Reserved1, Peb, Reserved2, Reserved3, ProcessId, ParentId;
    }
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process, int type, ref ProcessInfo info, int size, out int length);
    static long OriginPid() {
        long pid;
        if (long.TryParse(Env("AGENTDECK_ORIGIN_PID"), out pid) && pid != 0) return pid;
        var info = new ProcessInfo(); int length;
        return NtQueryInformationProcess(new IntPtr(-1), 0, ref info, Marshal.SizeOf(info), out length) == 0 ? info.ParentId.ToInt64() : 0;
    }
    static object Get(Dictionary<string, object> data, string key) { object value; return data.TryGetValue(key, out value) ? value : null; }
    static int Remaining(Stopwatch clock) { return Math.Max(1, 2200 - (int)clock.ElapsedMilliseconds); }
    static string Send(string root, string line, string id, out bool delivered) {
        delivered = false;
        var clock = Stopwatch.StartNew();
        try {
            int port = int.Parse(File.ReadAllText(Path.Combine(root, "port")).Trim());
            using (var client = new TcpClient()) {
                var connecting = client.BeginConnect("127.0.0.1", port, null, null);
                using (var wait = connecting.AsyncWaitHandle) {
                    if (!wait.WaitOne(Remaining(clock))) return "";
                    client.EndConnect(connecting);
                }
                using (var stream = client.GetStream()) {
                    stream.WriteTimeout = Remaining(clock);
                    byte[] bytes = Utf8.GetBytes(line + "\n"); stream.Write(bytes, 0, bytes.Length);
                    using (var response = new MemoryStream()) {
                        byte[] buffer = new byte[4096];
                        while (clock.ElapsedMilliseconds < 2200) {
                            stream.ReadTimeout = Remaining(clock);
                            int n = stream.Read(buffer, 0, buffer.Length);
                            if (n == 0) return "";
                            int end = Array.IndexOf(buffer, (byte)10, 0, n);
                            response.Write(buffer, 0, end < 0 ? n : end);
                            if (response.Length > 1048576) return "";
                            if (end < 0) continue;
                            string text = Utf8.GetString(response.ToArray());
                            if (text.Length > 262144) return "";
                            var reply = Json.DeserializeObject(text) as Dictionary<string, object>;
                            if (reply == null || !id.Equals(Get(reply, "id")) || !true.Equals(Get(reply, "accepted"))) return "";
                            delivered = true;
                            return Get(reply, "output") as string ?? "";
                        }
                    }
                }
            }
        } catch { /* Offline, malformed or late ACK: retain the same event ID. */ }
        return "";
    }
    static void Main(string[] args) {
        try {
            bool codex = Path.GetFileNameWithoutExtension(Environment.GetCommandLineArgs()[0]).Equals("agentdeck-codex-notify", StringComparison.OrdinalIgnoreCase);
            var options = new Dictionary<string, object> { { "Agent", codex ? "codex" : "claude" } };
            if (!codex) {
                options["MaxLabel"] = 40;
                var keys = new HashSet<string> { "-Agent", "-Status", "-Label", "-Subagent", "-SessionId", "-MaxLabel" };
                for (int i = 0; i < args.Length; i++) if (keys.Contains(args[i]) && i + 1 < args.Length) options[args[i].Substring(1)] = args[++i];
            }
            Dictionary<string, object> data = null;
            using (var reader = new StreamReader(Console.OpenStandardInput(), Utf8, true)) {
                try { data = Json.DeserializeObject(reader.ReadToEnd()) as Dictionary<string, object>; } catch { }
            }
            if (data == null) {
                if (!options.ContainsKey("SessionId")) return;
                data = new Dictionary<string, object>();
            }
            var hook = new Dictionary<string, object>();
            foreach (string field in new[] { "session_id", "hook_event_name", "agent_id", "agent_type", "cwd", "tool_name", "message", "error", "last_assistant_message" })
                if (data.ContainsKey(field)) hook[field] = data[field];
            var input = Get(data, "tool_input") as Dictionary<string, object>;
            if (input != null && Get(input, "file_path") is string && (string)input["file_path"] != "") hook["tool_input"] = new Dictionary<string, object> { { "file_path", input["file_path"] } };
            var env = new Dictionary<string, object>();
            foreach (string key in new[] { "AGENTDECK_TAB", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "AGENTDECK_CONTEXT" }) env[key] = Env(key);
            string id = Guid.NewGuid().ToString(), root = Root();
            var payload = new Dictionary<string, object> {
                { "channel", "agentdeck-hook" }, { "id", id }, { "ts", (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds },
                { "kind", "notify" }, { "pid", OriginPid() }, { "env", env }, { "options", options }, { "hook", hook }
            };
            string line = Json.Serialize(payload);
            if (Utf8.GetByteCount(line) > 240000) return;
            bool delivered;
            string output = Send(root, line, id, out delivered);
            if (!delivered) {
                try {
                    string dir = Path.Combine(root, "hook-inbox"); Directory.CreateDirectory(dir);
                    string file = Path.Combine(dir, id + ".json"), tmp = file + ".tmp";
                    File.WriteAllText(tmp, line, Utf8); File.Move(tmp, file);
                } catch { /* Reporting must never block the agent. */ }
            }
            byte[] result = Utf8.GetBytes(output);
            using (var stdout = Console.OpenStandardOutput()) stdout.Write(result, 0, result.Length);
        } catch { /* Invalid input is silent. */ }
    }
}
