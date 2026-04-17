import { app, BrowserWindow, screen, ipcMain } from 'electron';
import path from 'path';

let win: BrowserWindow | null = null;

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 250,
    height: 300,
    x: screenW - 270,
    y: screenH - 320,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      autoplayPolicy: 'no-user-gesture-required',
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadURL('http://127.0.0.1:3210');
  win.on('closed', () => { win = null; });

  // Handle drag from renderer
  ipcMain.on('window-drag', (_e, { dx, dy }) => {
    if (!win) return;
    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);
  });
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
