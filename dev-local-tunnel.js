#!/usr/bin/env node
/**
 * Script TODO-EN-UNO para desarrollo local con túnel
 * Inicia: Backend + Frontend + Túnel para Frontend + Túnel para Backend (webhooks)
 * 
 * USO: node dev-local-tunnel.js
 * 
 * Este script crea TODO lo que necesitas para trabajar localmente
 * y probar desde celular o cualquier dispositivo.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FRONTEND_PORT = 5173;
const BACKEND_PORT = 3001;

// Función para verificar si un servicio está listo
function checkServiceReady(port, path = '/', maxAttempts = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    let resolved = false;
    let timeoutId = null;
    
    const check = () => {
      if (resolved) return;
      
      attempts++;
      const req = http.get(`http://localhost:${port}${path}`, (res) => {
        if (resolved) return;
        
        // IMPORTANTE: Consumir los datos de la respuesta para cerrar la conexión
        res.resume();
        
        // Verificar status code
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolved = true;
          if (timeoutId) clearTimeout(timeoutId);
          req.destroy();
          resolve(true);
        } else {
          // Si no es exitoso, seguir intentando
          if (attempts >= maxAttempts) {
            resolved = true;
            if (timeoutId) clearTimeout(timeoutId);
            reject(new Error(`Servicio en puerto ${port} respondió con status ${res.statusCode}`));
          } else {
            setTimeout(check, 1000);
          }
        }
      });
      
      req.on('error', (err) => {
        if (resolved) return;
        
        if (attempts >= maxAttempts) {
          resolved = true;
          if (timeoutId) clearTimeout(timeoutId);
          reject(new Error(`Servicio en puerto ${port} no está listo después de ${maxAttempts} intentos: ${err.message}`));
        } else {
          setTimeout(check, 1000);
        }
      });
      
      // Usar setTimeout para mejor control en lugar de req.setTimeout
      timeoutId = setTimeout(() => {
        if (resolved) return;
        
        req.destroy();
        if (attempts >= maxAttempts) {
          resolved = true;
          reject(new Error(`Timeout esperando servicio en puerto ${port}`));
        } else {
          setTimeout(check, 1000);
        }
      }, 1000);
    };
    
    check();
  });
}

console.log('🚀 Iniciando DESARROLLO LOCAL COMPLETO con túneles\n');
console.log('📦 Esto iniciará:');
console.log('   1. Backend (puerto 3001)');
console.log('   2. Frontend (puerto 5173)');
console.log('   3. Túnel para Frontend (acceso desde celular)');
console.log('   4. Túnel para Backend (para webhooks de Notion)');
console.log('\n⏳ Espera unos segundos...\n');

// 1. Iniciar Backend
console.log('📦 [1/4] Iniciando backend...');
const backend = spawn('npm', ['run', 'backend:dev'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true
});

backend.on('error', (err) => {
  console.error('❌ Error iniciando backend:', err);
});

// 2. Esperar y luego iniciar Frontend
setTimeout(() => {
  console.log('\n🌐 [2/4] Iniciando frontend...');
  frontendProcess = spawn('npm', ['run', 'dev'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true
  });

  frontendProcess.on('error', (err) => {
    console.error('❌ Error iniciando frontend:', err);
  });

  // 3. Esperar a que el frontend esté listo y crear túnel
  console.log('\n⏳ Esperando a que el frontend esté listo...');
  checkServiceReady(FRONTEND_PORT, '/', 60)
    .then(() => {
      console.log('✅ Frontend está listo!');
      console.log('\n🔗 [3/4] Creando túnel para FRONTEND (acceso desde celular)...');
      
      const frontendTunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${FRONTEND_PORT}`], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let frontendUrl = '';
      let frontendUrlFound = false;
      
      const handleFrontendOutput = (data, source) => {
        const output = data.toString();
        if (!frontendUrlFound) {
          const urlPatterns = [
            /https:\/\/[a-z0-9-]+\.trycloudflare\.com/g,
            /(https?:\/\/[^\s]+trycloudflare[^\s]+)/g
          ];
          
          for (const pattern of urlPatterns) {
            const matches = output.match(pattern);
            if (matches && matches.length > 0) {
              frontendUrl = matches[0].replace(/\/$/, '');
              frontendUrlFound = true;
              console.log('\n✅ TÚNEL FRONTEND LISTO!');
              console.log('📱 URL para acceder desde tu celular/tablet/otra computadora:');
              console.log(`   ${frontendUrl}`);
              console.log('');
              break;
            }
          }
        }
        // No mostrar toda la salida de cloudflared (es muy verbosa)
      };
      
      frontendTunnel.stdout.on('data', (data) => handleFrontendOutput(data, 'stdout'));
      frontendTunnel.stderr.on('data', (data) => handleFrontendOutput(data, 'stderr'));
    
      frontendTunnel.on('close', () => {
        console.log('\n🔌 Túnel frontend cerrado');
      });
      
      process.frontendTunnel = frontendTunnel;
      
      // 4. Esperar a que el backend esté listo y crear túnel
      console.log('\n⏳ Esperando a que el backend esté listo...');
      checkServiceReady(BACKEND_PORT, '/api/health', 60)
        .then(() => {
          console.log('✅ Backend está listo!');
          console.log('🔗 [4/4] Creando túnel para BACKEND (webhooks de Notion)...');
          
          const backendTunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${BACKEND_PORT}`], {
            stdio: ['ignore', 'pipe', 'pipe']
          });
          
          let backendUrl = '';
          let backendUrlFound = false;
          
          const handleBackendOutput = (data, source) => {
            const output = data.toString();
            if (!backendUrlFound) {
              const urlPatterns = [
                /https:\/\/[a-z0-9-]+\.trycloudflare\.com/g,
                /(https?:\/\/[^\s]+trycloudflare[^\s]+)/g
              ];
              
              for (const pattern of urlPatterns) {
                const matches = output.match(pattern);
                if (matches && matches.length > 0) {
                  backendUrl = matches[0].replace(/\/$/, '');
                  backendUrlFound = true;
                  console.log('\n✅ TÚNEL BACKEND LISTO!');
                  console.log('🌐 URL del backend (para webhook de Notion):');
                  console.log(`   ${backendUrl}/api/notion/webhook`);
                  console.log('');
                  console.log('═══════════════════════════════════════════════════════');
                  console.log('🎉 ¡TODO ESTÁ LISTO!');
                  console.log('═══════════════════════════════════════════════════════');
                  if (frontendUrl) {
                    console.log(`📱 Frontend: ${frontendUrl}`);
                  }
                  if (backendUrl) {
                    console.log(`🌐 Backend:  ${backendUrl}/api/notion/webhook`);
                  }
                  console.log('');
                  console.log('💡 TIPS:');
                  console.log('   - Abre la URL del frontend desde tu celular');
                  console.log('   - Usa la URL del backend para configurar webhooks de Notion');
                  console.log('   - Para detener TODO: Ctrl+C en esta terminal');
                  console.log('═══════════════════════════════════════════════════════\n');
                  break;
                }
              }
            }
          };
          
          backendTunnel.stdout.on('data', (data) => handleBackendOutput(data, 'stdout'));
          backendTunnel.stderr.on('data', (data) => handleBackendOutput(data, 'stderr'));
      
          backendTunnel.on('close', () => {
            console.log('\n🔌 Túnel backend cerrado');
          });
          
          // Guardar referencias para poder cerrarlos
          process.backendTunnel = backendTunnel;
        })
        .catch((err) => {
          console.error('❌ Error esperando backend:', err.message);
        });
    })
    .catch((err) => {
      console.error('❌ Error esperando frontend:', err.message);
    });
}, 3000);

// Guardar referencias globales
let frontendProcess = null;

// Manejar cierre limpio
const cleanup = () => {
  console.log('\n\n🛑 Cerrando TODO...');
  if (process.frontendTunnel) process.frontendTunnel.kill();
  if (process.backendTunnel) process.backendTunnel.kill();
  if (backend) backend.kill();
  if (frontendProcess) frontendProcess.kill();
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);


