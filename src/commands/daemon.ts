import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { basename, join } from 'path';
import { homedir, platform } from 'os';
import { handleJobsCommand } from './jobs.js';

function home(): string { return process.env.GRAIN_HOME || join(homedir(), '.grain'); }
function pidPath(): string { return join(home(), 'daemon.pid'); }
function logPath(): string { return join(home(), 'logs', 'daemon.log'); }

export function daemonPid(): number | undefined {
  if (!existsSync(pidPath())) return undefined;
  const pid = Number(readFileSync(pidPath(), 'utf8').trim());
  if (!Number.isInteger(pid) || pid < 1) return undefined;
  try { process.kill(pid, 0); return pid; } catch { try { unlinkSync(pidPath()); } catch {} return undefined; }
}

function daemonArgs(): string[] {
  return basename(process.execPath).startsWith('bun') ? [process.argv[1], 'daemon', 'run'] : ['daemon', 'run'];
}

async function waitForDaemonReady(expectedPid: number, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (daemonPid() === expectedPid) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Grain daemon did not become ready within ${timeoutMs}ms. Check ${logPath()}`);
}

export async function runDaemon(intervalMs = 30_000): Promise<void> {
  const existing = daemonPid();
  if (existing && existing !== process.pid) throw new Error(`Grain daemon is already running (pid ${existing})`);
  mkdirSync(home(), { recursive: true });
  let pidFile: number;
  try {
    pidFile = openSync(pidPath(), 'wx', 0o600); writeFileSync(pidFile, `${process.pid}\n`); closeSync(pidFile);
  } catch (error: any) {
    if (error?.code === 'EEXIST') throw new Error(`Grain daemon ownership is already claimed (${pidPath()})`);
    throw error;
  }
  let stopping = false; const stop = () => { stopping = true; };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    while (!stopping) {
      await handleJobsCommand('run-due');
      if (stopping) break;
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); process.off('SIGTERM', done); process.off('SIGINT', done); resolve(); };
        const timer = setTimeout(done, intervalMs);
        process.once('SIGTERM', done); process.once('SIGINT', done);
      });
    }
  } finally {
    try { if (Number(readFileSync(pidPath(), 'utf8').trim()) === process.pid) unlinkSync(pidPath()); } catch {}
  }
}

export async function handleDaemonCommand(subcommand = 'status'): Promise<void> {
  if (subcommand === 'run') { await runDaemon(); return; }
  if (subcommand === 'status') {
    const pid = daemonPid(); console.log(pid ? `running (pid ${pid})` : 'stopped'); if (!pid) process.exitCode = 1; return;
  }
  if (subcommand === 'start') {
    const existing = daemonPid(); if (existing) { console.log(`Already running (pid ${existing})`); return; }
    mkdirSync(join(home(), 'logs'), { recursive: true });
    const fd = openSync(logPath(), 'a', 0o600);
    const child = spawn(process.execPath, daemonArgs(), { detached: true, stdio: ['ignore', fd, fd], env: { ...process.env } });
    child.unref(); closeSync(fd);
    if (!child.pid) throw new Error('Grain daemon failed to start: no process id was assigned');
    try { await waitForDaemonReady(child.pid); }
    catch (error) { try { process.kill(child.pid, 'SIGTERM'); } catch {} throw error; }
    console.log(`Started Grain daemon (pid ${child.pid}). Logs: ${logPath()}`); return;
  }
  if (subcommand === 'stop') {
    const pid = daemonPid(); if (!pid) { console.log('Daemon is not running.'); return; }
    process.kill(pid, 'SIGTERM'); console.log(`Stopping Grain daemon (pid ${pid}).`); return;
  }
  if (subcommand === 'logs') {
    console.log(existsSync(logPath()) ? readFileSync(logPath(), 'utf8') : 'No daemon logs yet.'); return;
  }
  if (subcommand === 'install') {
    mkdirSync(join(home(), 'daemon'), { recursive: true });
    const executable = process.execPath; const argumentsForService = [executable, ...daemonArgs()];
    if (platform() === 'darwin') {
      const path = join(home(), 'daemon', 'com.grain.scheduler.plist');
      const xml = (value: string) => value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
      writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>com.grain.scheduler</string><key>ProgramArguments</key><array>${argumentsForService.map(value => `<string>${xml(value)}</string>`).join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>\n`);
      console.log(`Wrote ${path}. Review it, then copy it to ~/Library/LaunchAgents/.`);
    } else {
      const path = join(home(), 'daemon', 'grain.service');
      const escaped = argumentsForService.map(value => `"${value.replace(/([\\"])/gu, '\\$1')}"`).join(' ');
      writeFileSync(path, `[Unit]\nDescription=Grain scheduled coding jobs\n\n[Service]\nExecStart=${escaped}\nRestart=on-failure\n\n[Install]\nWantedBy=default.target\n`);
      console.log(`Wrote ${path}. Review it, then install it with systemctl --user.`);
    }
    return;
  }
  throw new Error('Usage: grain daemon start|run|status|stop|logs|install');
}
