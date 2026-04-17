#!/usr/bin/env node
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(os.homedir(), '.minipet-overlay');
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');
const PID_FILE = path.join(DATA_DIR, 'server.pid');
const INIT_FLAG = path.join(DATA_DIR, 'initialized');
const BINDINGS_FILE = path.join(DATA_DIR, 'bindings.json');

function loadBindings(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(BINDINGS_FILE, 'utf-8')); } catch { return {}; }
}

function saveBinding(dna: string, name: string) {
  const bindings = loadBindings();
  bindings[dna] = name;
  fs.writeFileSync(BINDINGS_FILE, JSON.stringify(bindings, null, 2));
}

function getLocalDna(): string | null {
  try {
    const statePath = path.join(os.homedir(), '.claude-minipet', 'state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    return state.dna || null;
  } catch { return null; }
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function isRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function getRunningPid(): number | null {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
    return isRunning(pid) ? pid : null;
  } catch { return null; }
}

function ensureClaudeMinipet() {
  // Check if claude-minipet is already installed (either version)
  try {
    execSync('claude-minipet --help', { stdio: 'ignore' });
    return; // already installed
  } catch {}

  // Auto install claude-minipet
  console.log('📦 正在安装 claude-minipet（Claude Code 宠物插件）...');
  try {
    execSync('npm install -g claude-minipet', { stdio: 'inherit' });
  } catch {
    console.log('⚠️  claude-minipet 安装失败，莎莎仍可使用（点击互动 + 饭点提醒）');
    return;
  }

  // Auto init
  console.log('🐾 正在初始化 claude-minipet...');
  try {
    execSync('claude-minipet init', { stdio: 'inherit' });
  } catch {
    console.log('⚠️  claude-minipet init 失败，请稍后手动运行: claude-minipet init');
  }
}

function configureMinipet() {
  // Auto-configure claude-minipet to push events to us
  const configPath = path.join(os.homedir(), '.claude-minipet', 'config.json');
  try {
    let config: Record<string, any> = {};
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    if (config.desktopPetUrl !== 'http://localhost:3210') {
      config.desktopPetUrl = 'http://localhost:3210';
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('✅ claude-minipet 已自动配置');
    }
  } catch {
    // minipet not installed, that's fine
  }
}

function openBrowser() {
  const url = 'http://127.0.0.1:3210';
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { execSync(`${cmd} ${url}`); } catch {}
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function onboarding() {
  console.log('');
  console.log('🤖 欢迎使用 AI 编程搭子！');
  console.log('');
  console.log('请选择你的编程搭子形象：');
  console.log('  1. 使用默认形象');
  console.log('  2. 上传照片生成自定义形象');
  console.log('');

  const choice = await ask('请输入 (1/2): ');

  if (choice === '2') {
    const photoPath = await ask('请输入照片路径: ');
    if (!photoPath) {
      console.log('未输入路径，使用默认形象');
    } else {
      const name = await ask('给形象起个名字（直接回车用文件名）: ');
      if (name) {
        process.argv.push('--name', name);
      }
      console.log('');
      console.log('开始生成形象，这需要大约 10-20 分钟...');
      console.log('生成完成后会自动启动编程搭子。');
      console.log('');
      await generate(photoPath);
    }
  } else {
    console.log('已选择默认形象');
  }

  fs.writeFileSync(INIT_FLAG, new Date().toISOString());
}

async function start() {
  const existing = getRunningPid();
  if (existing) {
    console.log(`编程搭子已经在运行了 (PID: ${existing})`);
    console.log('运行 minipet-overlay stop 先停止');
    return;
  }

  ensureDataDir();
  ensureClaudeMinipet();
  configureMinipet();

  // First-time onboarding
  if (!fs.existsSync(INIT_FLAG)) {
    await onboarding();
  }

  // Start server as detached child
  const serverScript = path.join(ROOT, 'dist', 'server.js');
  const child = spawn(process.execPath, [serverScript], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));

  // Wait for server to be ready
  await new Promise(r => setTimeout(r, 2000));
  console.log(`🤖 编程搭子后端已启动 (PID: ${child.pid})`);

  // Try to launch Electron
  const electronPath = resolveElectron();
  if (electronPath) {
    // Compile electron main if needed
    const mainJs = path.join(ROOT, 'dist-electron', 'main.js');
    if (!fs.existsSync(mainJs)) {
      try {
        const tscPath = path.join(ROOT, 'node_modules', '.bin', 'tsc');
        execSync(`"${tscPath}" -p "${path.join(ROOT, 'tsconfig.electron.json')}"`, { stdio: 'ignore' });
      } catch {}
    }
    if (fs.existsSync(mainJs)) {
      try {
        const electronChild = spawn(electronPath, [ROOT], {
          detached: true,
          stdio: 'ignore',
        });
        electronChild.on('error', () => {
          console.log('💡 Electron 启动失败，在浏览器打开: http://127.0.0.1:3210');
          openBrowser();
        });
        electronChild.unref();
        console.log('🖥️  桌面悬浮窗已启动');
      } catch {
        console.log('💡 Electron 启动失败，在浏览器打开: http://127.0.0.1:3210');
        openBrowser();
      }
    }
  } else {
    console.log('💡 Electron 未安装，使用浏览器模式');
    console.log('   请在浏览器打开: http://127.0.0.1:3210');
    openBrowser();
  }

  console.log('\n✨ 编程搭子准备好了！用 Claude Code 写代码试试~');
  console.log('   停止: minipet-overlay stop');
  console.log('   生成自定义形象: minipet-overlay generate <照片路径>');
  console.log('   切换形象: minipet-overlay use <名称|default>');
  console.log('   查看可用形象: minipet-overlay list');
}

function resolveElectron(): string | null {
  // Use electron's node API to get the actual binary path
  try {
    const electronPkg = path.join(ROOT, 'node_modules', 'electron', 'index.js');
    if (fs.existsSync(electronPkg)) {
      // electron module exports the path to the binary
      const binPath = execSync(`"${process.execPath}" -e "process.stdout.write(require('${electronPkg.replace(/\\/g, '/')}')||'')"`, { encoding: 'utf-8' }).trim();
      if (binPath && fs.existsSync(binPath)) return binPath;
    }
  } catch {}
  // Check if globally available
  try {
    const cmd = process.platform === 'win32' ? 'where electron' : 'which electron';
    const result = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (result) return result.split('\n')[0].trim();
  } catch {}
  return null;
}

function stop() {
  const pid = getRunningPid();
  if (!pid) {
    console.log('编程搭子没有在运行');
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    fs.unlinkSync(PID_FILE);
    console.log('🤖 编程搭子已停止');
  } catch {
    console.log('停止失败，请手动 kill', pid);
  }
  // Also kill any electron processes
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /f /im electron.exe 2>nul', { stdio: 'ignore' });
    } else {
      execSync('pkill -f "electron.*minipet-overlay" 2>/dev/null', { stdio: 'ignore' });
    }
  } catch {}
}

function status() {
  const pid = getRunningPid();
  if (pid) {
    console.log(`🤖 编程搭子正在运行 (PID: ${pid})`);
    console.log(`   后端: http://127.0.0.1:3210`);
  } else {
    console.log('😴 编程搭子没有在运行');
    console.log('   启动: minipet-overlay start');
  }
}

async function generate(photoPath: string) {
  if (!photoPath) {
    console.log('用法: minipet-overlay generate <photo-path> [--name <名称>]');
    console.log('  支持 .jpg / .jpeg / .png 格式');
    console.log('  --name 可选，不填则自动用照片文件名');
    return;
  }

  const resolvedPath = path.resolve(photoPath);
  if (!fs.existsSync(resolvedPath)) {
    console.log(`文件不存在: ${resolvedPath}`);
    return;
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(ext)) {
    console.log('不支持的格式，请使用 .jpg / .jpeg / .png');
    return;
  }

  // Get name from --name arg, or fall back to photo filename
  const nameArgIdx = process.argv.indexOf('--name');
  let name = nameArgIdx >= 0 ? process.argv[nameArgIdx + 1] : null;
  if (!name) {
    name = path.basename(resolvedPath, ext);
  }

  // Sanitize name for use as directory name
  const safeName = name.replace(/[\/\\:*?"<>|]/g, '_').trim();
  if (!safeName) {
    console.log('名称无效');
    return;
  }

  const outputDir = path.join(AVATARS_DIR, safeName);
  console.log('🎨 开始生成自定义形象...');
  console.log(`   照片: ${resolvedPath}`);
  console.log(`   名称: ${safeName}`);
  console.log(`   输出: ${outputDir}`);
  console.log('');

  try {
    const { generatePetAssets } = await import('./generator/pipeline');
    await generatePetAssets(resolvedPath, outputDir, (stage, progress, message) => {
      const pct = Math.round(progress * 100);
      console.log(`  [${stage}] ${pct}% - ${message}`);
    });
    // Auto-bind current user's DNA to this avatar
    const dna = getLocalDna();
    if (dna) {
      saveBinding(dna, safeName);
    }

    // Auto-switch to the new avatar if server is running
    try {
      await fetch('http://127.0.0.1:3210/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'avatar_switch_manual', dna: safeName }),
      });
    } catch {}

    console.log('');
    console.log('✨ 自定义形象生成完毕，已自动切换！');
    console.log(`   名称: ${safeName}`);
  } catch (err: any) {
    console.error('生成失败:', err.message);
  }
}

function listAvatars() {
  console.log('🎭 可用形象:\n');

  // Default avatar
  console.log('  default     莎莎（默认）');

  // Custom avatars
  const dirs: string[] = [];
  if (fs.existsSync(AVATARS_DIR)) {
    for (const d of fs.readdirSync(AVATARS_DIR)) {
      if (fs.existsSync(path.join(AVATARS_DIR, d, 'matted', 'sitting.webm'))) {
        dirs.push(d);
      }
    }
  }

  for (const name of dirs) {
    let desc = '';
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(AVATARS_DIR, name, 'manifest.json'), 'utf-8'));
      desc = manifest.subject_description || '';
    } catch {}
    console.log(`  ${name}`);
    if (desc) console.log(`              ${desc}`);
  }

  if (dirs.length === 0) {
    console.log('\n  还没有自定义形象，使用 minipet-overlay generate <照片路径> --name <名称> 生成');
  }
}

async function useAvatar(target: string) {
  if (!target) {
    console.log('用法: minipet-overlay use <名称|default>');
    console.log('  use default    切换回默认形象');
    console.log('  use <名称>     切换到指定名称的形象');
    console.log('\n运行 minipet-overlay list 查看可用形象');
    return;
  }

  const isDefault = target === 'default' || target === '默认';

  if (!isDefault) {
    if (!fs.existsSync(path.join(AVATARS_DIR, target, 'matted', 'sitting.webm'))) {
      console.log(`形象不存在: ${target}`);
      console.log('运行 minipet-overlay list 查看可用形象');
      return;
    }
  }

  const avatarName = isDefault ? null : target;

  const pid = getRunningPid();
  if (pid) {
    try {
      await fetch('http://127.0.0.1:3210/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'avatar_switch_manual', dna: avatarName }),
      });
    } catch {}
  }

  if (isDefault) {
    console.log('✅ 已切换到默认形象');
  } else {
    console.log(`✅ 已切换到形象: ${target}`);
  }

  if (!pid) {
    console.log('   编程搭子未运行，下次启动时生效');
  }
}

// ---- Main ----
const cmd = process.argv[2];
switch (cmd) {
  case 'start': start(); break;
  case 'stop': stop(); break;
  case 'status': status(); break;
  case 'generate': generate(process.argv[3]); break;
  case 'list': listAvatars(); break;
  case 'use': useAvatar(process.argv[3]); break;
  default:
    console.log('🤖 minipet-overlay — AI 编程搭子');
    console.log('');
    console.log('用法:');
    console.log('  minipet-overlay start              启动编程搭子');
    console.log('  minipet-overlay stop               停止');
    console.log('  minipet-overlay status             查看状态');
    console.log('  minipet-overlay generate <照片> [--name <名称>] 生成自定义形象');
    console.log('  minipet-overlay list                          查看可用形象');
    console.log('  minipet-overlay use <名称|default>             切换形象');
}
