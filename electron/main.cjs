const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('node:path');
const { startSidecar } = require('./sidecar.cjs');

// Vite dev server URL used only when running `npm run electron:dev`
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow = null;
let sidecar = null;

function createWindow(apiPort) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#141414', // matches canvas bg -> avoids white flash on load
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--api-port=${apiPort}`],
    },
  });

  // Show window once content is ready to avoid a white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (DEV_SERVER_URL) {
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Open any external links (http/https) in the OS browser instead of inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Minimal menu — the app has its own toolbar, so keep the native chrome out of the way
function setAppMenu() {
  if (process.platform === 'darwin') {
    const template = [
      {
        label: app.getName(),
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    Menu.setApplicationMenu(null);
  }
}

app.whenReady().then(async () => {
  setAppMenu();

  try {
    sidecar = await startSidecar();
  } catch (err) {
    dialog.showErrorBox(
      'Corelyn Studio failed to start',
      `The backend service did not come online:\n\n${err.message}`,
    );
    app.quit();
    return;
  }

  createWindow(sidecar.port);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(sidecar.port);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
