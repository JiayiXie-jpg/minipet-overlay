import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const AUTH_FILE = path.join(os.homedir(), '.claude-minipet', 'auth.json');
export const DIY_SERVER = process.env.DIY_SERVER || 'https://minipet.crazyma99.xyz';

export function loadAuth(): { token: string; email: string; userId: number } | null {
  try {
    const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    if (data.token) return data;
    return null;
  } catch {
    return null;
  }
}

export function getJwtToken(): string | null {
  return loadAuth()?.token || null;
}

export function getDiyServerUrl(): string {
  return DIY_SERVER;
}

export function openDiyWebUI() {
  const auth = loadAuth();
  const token = auth?.token || '';
  const url = token ? `${DIY_SERVER}/diy?token=${token}` : `${DIY_SERVER}/diy`;
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    execSync(`${cmd} "${url}"`);
  } catch {}
}
