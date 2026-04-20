// postinstall script — runs after npm install -g
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

try {
  if (process.env.CI || process.env.DOCKER) process.exit(0);

  const DATA_DIR = path.join(os.homedir(), '.minipet-overlay');
  const PID_FILE = path.join(DATA_DIR, 'server.pid');
  const ROOT = path.join(__dirname, '..');
  const serverScript = path.join(ROOT, 'dist', 'server.js');

  let restarted = false;

  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
    // Check if process is running
    process.kill(pid, 0);
    // Process is running, restart it
    console.log('检测到运行中的编程搭子，正在重启...');
    process.kill(pid, 'SIGTERM');
    // Brief delay for cleanup
    const start = Date.now();
    while (Date.now() - start < 1500) { /* busy wait */ }
    // Start new process
    const child = spawn(process.execPath, [serverScript], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    child.unref();
    fs.writeFileSync(PID_FILE, String(child.pid));
    console.log(`✅ 编程搭子已重启 (PID: ${child.pid})`);
    restarted = true;
  } catch {
    // No running process or can't read PID file — that's fine
  }

  if (!restarted) {
    console.log('');
    console.log('minipet-overlay installed!');
    console.log('');
    console.log('   Start: minipet-overlay start');
    console.log('');
  }
} catch {
  // ignore all errors during postinstall
}
