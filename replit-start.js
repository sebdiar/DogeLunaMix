#!/usr/bin/env node
/**
 * Script de inicio para Replit
 * Ejecuta backend y frontend en paralelo
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Puerto del frontend (Cloud Run/Replit lo asigna automáticamente a PORT)
const FRONTEND_PORT = process.env.PORT || 5000;

// Puerto del backend (siempre interno, nunca expuesto)
const BACKEND_PORT = 3001;

console.log('🚀 Iniciando DogeUB en Replit...');
console.log(`📦 Frontend: puerto ${FRONTEND_PORT}`);
console.log(`🌐 Backend: puerto ${BACKEND_PORT}`);

// Establecer variables de entorno
process.env.BACKEND_PORT = BACKEND_PORT.toString();
process.env.PORT = FRONTEND_PORT.toString();

// Verificar que el build existe
import { existsSync } from 'fs';
const distPath = join(__dirname, 'dist', 'index.html');
if (!existsSync(distPath)) {
  console.log('📦 Build no encontrado. Construyendo frontend...');
  const build = spawn('npm', ['run', 'build'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true
  });
  
  build.on('close', (code) => {
    if (code !== 0) {
      console.error('❌ Error en el build');
      process.exit(1);
    }
    startServers();
  });
} else {
  startServers();
}

function startServers() {
  // Iniciar backend
  console.log('📦 Iniciando backend...');
  const backend = spawn('node', ['backend/server.js'], {
    cwd: __dirname,
    env: { ...process.env, BACKEND_PORT: BACKEND_PORT.toString() },
    stdio: 'inherit',
    shell: true
  });

  backend.on('error', (err) => {
    console.error('❌ Error iniciando backend:', err);
  });

  backend.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`❌ Backend terminó con código ${code}`);
    }
  });

  // Iniciar frontend (después de un breve delay para que el backend arranque)
  setTimeout(() => {
    console.log('🌐 Iniciando frontend...');
    const frontend = spawn('node', ['server.js'], {
      cwd: __dirname,
      env: { 
        ...process.env, 
        PORT: FRONTEND_PORT.toString(),
        BACKEND_PORT: BACKEND_PORT.toString(),
        BACKEND_URL: `http://localhost:${BACKEND_PORT}`
      },
      stdio: 'inherit',
      shell: true
    });

    frontend.on('error', (err) => {
      console.error('❌ Error iniciando frontend:', err);
    });

    frontend.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`❌ Frontend terminó con código ${code}`);
      }
    });
  }, 2000);

  // Manejar cierre
  process.on('SIGINT', () => {
    console.log('\n🛑 Cerrando servidores...');
    backend.kill();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Cerrando servidores...');
    backend.kill();
    process.exit(0);
  });
}

