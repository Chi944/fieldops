import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { acquireSession, parseFlags, personalAIEnvironment, personalDirectory, PersonalToolError, preflight, privateChildEnvironment, projectRoot, reportFailure, stringFlag } from "./personal-tools";

async function command(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn(process.execPath, args, { cwd: projectRoot, env, stdio: "inherit", windowsHide: true, shell: false });
  await new Promise<void>((done, reject) => { child.once("error", reject); child.once("close", code => code === 0 ? done() : reject(new PersonalToolError("FieldOps asset setup failed. Run npm ci, then retry."))); });
}

/** Only terminates the subprocess tree created by this launcher, never a discovered port owner. */
async function stopChild(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    const stop = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, shell: false });
    await new Promise<void>(done => { stop.once("error", () => done()); stop.once("close", () => done()); });
  } else child.kill("SIGTERM");
}

async function main() {
  const flags = parseFlags(process.argv.slice(2), ["check", "data", "port", "help", "ai"]);
  if (flags.help) { console.log("npm run personal -- [--check] [--ai] [--port=3001] [--data=.fieldops/personal]\nRuns FieldOps on 127.0.0.1 using a free port from 3001–3009. AI is off by default. --ai reads .env.ai.local and sends parsed quotation text to Groq for interpretation. --check reports readiness without starting the app, calling AI or changing saved data. Ctrl+C stops only this session."); return; }
  if (flags.ai !== undefined && flags.ai !== true) throw new PersonalToolError("Use --ai without a value to explicitly enable automatic interpretation.");
  const aiEnabled = flags.ai === true;
  const directory = resolve(stringFlag(flags, "data", personalDirectory));
  const requested = flags.port === undefined ? undefined : Number(stringFlag(flags, "port"));
  let env = privateChildEnvironment(directory);
  if (aiEnabled) {
    let contents: string;
    try { contents = await readFile(join(projectRoot, ".env.ai.local"), "utf8"); }
    catch { throw new PersonalToolError("Create .env.ai.local with the dedicated Groq key and verified Free Plan/ZDR settings before using --ai."); }
    env = personalAIEnvironment(env, contents);
  }
  const status = await preflight(directory, requested);
  if (aiEnabled) status.checks = status.checks.map(check => check.name === "Live AI" ? { ...check, detail: "Enabled explicitly. Parsed quotation text is processed by Groq with inference ZDR; originals stay in this local workspace. This check makes no model request." } : check);
  console.log(`FieldOps personal workspace — private local mode, live AI ${aiEnabled ? "enabled" : "disabled"}\n`);
  for (const check of status.checks) console.log(`${check.ok ? "OK" : check.required ? "BLOCKED" : "OPTIONAL"}  ${check.name}: ${check.detail}`);
  if (!status.ready || status.port === undefined) { process.exitCode = 1; return; }
  if (flags.check) return;
  env.FIELDOPS_PERSONAL_PORT = String(status.port);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const releaseSession = await acquireSession(directory, status.port);
  try {
    await command([join(projectRoot, "scripts", "prepare-assets.mjs")], env);
    console.log(`\nStarting http://127.0.0.1:${status.port}\nPersonal data: ${directory}\nFirst page load compiles the local app. Keep this terminal open; Ctrl+C stops the session.\n`);
    const child = spawn(process.execPath, [join(projectRoot, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(status.port)], { cwd: projectRoot, env, stdio: "inherit", windowsHide: true, shell: false });
    let stopping = false;
    const stop = () => { if (!stopping) { stopping = true; void stopChild(child); } };
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    const controller = new AbortController();
    const verifyStarted = async () => {
      for (let attempt = 0; attempt < 90 && !controller.signal.aborted; attempt++) {
        try {
          const response = await fetch(`http://127.0.0.1:${status.port}/api/status`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]) });
          if (response.ok) {
            const capability = await response.json() as { mode?: string; canPersist?: boolean; canUpload?: boolean; canExtract?: boolean };
            if (capability.mode !== "local" || !capability.canPersist || !capability.canUpload || capability.canExtract !== aiEnabled) { console.error("The server did not confirm the requested local storage and AI mode. Stopping this launch."); process.exitCode = 1; stop(); return; }
            console.log(`\nPersonal workspace ready: http://127.0.0.1:${status.port}\nReal local uploads and comparison are available. Live AI is ${aiEnabled ? "enabled; parsed text is sent to Groq" : "disabled"}.\n`); return;
          }
        } catch { /* Initial compilation and startup can take a few seconds. */ }
        await new Promise<void>(done => {
          const finish = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", finish); done(); };
          const timer = setTimeout(finish, 1000); controller.signal.addEventListener("abort", finish, { once: true });
          if (controller.signal.aborted) finish();
        });
      }
      if (!controller.signal.aborted) { console.error("FieldOps did not become ready within the startup deadline. Stopping this launch; no other process was stopped."); process.exitCode = 1; stop(); }
    };
    const verification = verifyStarted();
    try {
      await new Promise<void>((done, reject) => { child.once("error", reject); child.once("close", code => { if (!stopping && code !== 0) process.exitCode = code ?? 1; done(); }); });
    } finally { controller.abort(); await verification; process.off("SIGINT", stop); process.off("SIGTERM", stop); }
  } finally { await releaseSession(); }
}
main().catch(reportFailure);
