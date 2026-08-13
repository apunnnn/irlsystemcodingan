const { app, BrowserWindow, ipcMain, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

// Tambahan Modul untuk Server Lokal Subtitle
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

let win;
let localServer; // Menyimpan referensi server agar bisa dimatikan nanti

// =====================================================================
// 🚀 FUNGSI MENYALAKAN SERVER LOKAL UNTUK SUBTITLE AI (PORT 5050)
// =====================================================================
function startLocalServer() {
  const localApp = express();
  localServer = http.createServer(localApp);
  const io = new Server(localServer, {
    cors: { origin: "*" }
  });

  const PORT = 5050;
  const subtitleSettings = {};

  // Menyajikan file subtitle.html dari folder 'local_web'
  localApp.use(express.static(path.join(__dirname, 'local_web')));

  io.on('connection', (socket) => {
    // Klien/OBS bergabung ke room ID tertentu
    socket.on('join_subtitle', (streamId) => {
      socket.join(`sub_${streamId}`);
      if (subtitleSettings[streamId]) {
        socket.emit('update_settings', subtitleSettings[streamId]);
      }
    });

    // Menerima hasil ketikan/suara AI dan mengirim ke OBS di room yang sama
    socket.on('send_transcription', (data) => {
      const { streamId, text, isFinal, wordLimit } = data;
      io.to(`sub_${streamId}`).emit('new_transcription', { text, isFinal, wordLimit });
    });

    // Perintah menghapus teks di OBS
    socket.on('clear_transcription', (streamId) => {
      io.to(`sub_${streamId}`).emit('clear_text');
    });

    // Menyimpan pengaturan kustomisasi desain dari Control Panel
    socket.on('save_settings', (data) => {
      const { streamId, settings } = data;
      subtitleSettings[streamId] = settings;
      io.to(`sub_${streamId}`).emit('update_settings', settings);
    });
  });

  localServer.listen(PORT, () => {
    console.log(`✅ Local Server Subtitle aktif di http://localhost:${PORT}`);
  });
}

// =====================================================================
// 💻 KONFIGURASI ELECTRON UTAMA
// =====================================================================
function createWindow () {
  win = new BrowserWindow({
    width: 1000,
    height: 750,
    autoHideMenuBar: true, 
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: true,     
      contextIsolation: false    
    }
  });

  // Mematikan menu bar permanen agar tampilan clean
  win.removeMenu();

  win.loadFile('index.html');

  // Trigger pengecekan auto-update setelah window siap ditampilkan
  win.once('ready-to-show', () => {
    // 1. Setting agar update diam-diam di background dan install saat diclose
    autoUpdater.autoDownload = true; 
    autoUpdater.autoInstallOnAppQuit = true; 
    
    // 2. Cek update (tanpa notifikasi pop-up OS Windows yang mengganggu)
    autoUpdater.checkForUpdates();
  });
}

app.whenReady().then(() => {
  // =====================================================================
  // CHEAT CODE: OTOMATIS MENGIZINKAN MIKROFON & KAMERA DI DALAM SOFTWARE (.EXE)
  // =====================================================================
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true); // Langsung ACC tanpa nanya ke user!
    } else {
      callback(false);
    }
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media') {
      return true;
    }
    return false;
  });
  // =====================================================================

  // Nyalakan server localhost di background sebelum memunculkan UI
  startLocalServer();
  createWindow();
});

app.on('window-all-closed', () => {
  // Matikan server lokal saat aplikasi diclose agar port 5050 tidak nyangkut (Error)
  if (localServer) {
    localServer.close();
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ========================================================
// EVENT LISTENER UNTUK AUTO UPDATE (ELECTRON-UPDATER)
// ========================================================

autoUpdater.on('update-available', (info) => {
  if (win && !win.isDestroyed()) {
    win.webContents.send('update-status', { status: 'available', version: info.version });
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  if (win && !win.isDestroyed()) {
    win.webContents.send('update-progress', progressObj.percent);
  }
});

autoUpdater.on('update-downloaded', () => {
  if (win && !win.isDestroyed()) {
    win.webContents.send('update-status', { status: 'downloaded' });
  }
});

autoUpdater.on('error', (err) => {
  if (win && !win.isDestroyed()) {
    win.webContents.send('update-error', err.message);
  }
});

ipcMain.on('restart-app', () => {
  autoUpdater.quitAndInstall();
});