#!/usr/bin/env node
/**
 * Script para desarrollo con túnel HTTPS (para testing en mobile)
 * Inicia backend, frontend y crea un túnel HTTPS con localtunnel
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FRONTEND_PORT = 5173;
const BACKEND_PORT = 3001;

console.log('🚀 Iniciando desarrollo con túnel HTTPS...\n');

// Iniciar backend
console.log('📦 Iniciando backend en puerto', BACKEND_PORT);
const backend = spawn('npm', ['run', 'backend:dev'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true
});

backend.on('error', (err) => {
  console.error('❌ Error iniciando backend:', err);
});

// Esperar un poco y luego iniciar frontend
setTimeout(() => {
  console.log('🌐 Iniciando frontend en puerto', FRONTEND_PORT);
  const frontend = spawn('npm', ['run', 'dev'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true
  });

  frontend.on('error', (err) => {
    console.error('❌ Error iniciando frontend:', err);
  });

  // Esperar a que el frontend esté listo y crear túnel
  setTimeout(async () => {
    try {
      console.log('\n🔗 Creando túnel HTTPS...');
      
      // Detectar el puerto real que Vite está usando
      // Esperar un poco más para que Vite termine de iniciar
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      let actualPort = FRONTEND_PORT;
      try {
        // Buscar el puerto más alto que esté en uso (Vite usa el siguiente disponible si 5173 está ocupado)
        // Verificar desde 5180 hacia abajo para encontrar el más reciente
        for (let port = 5180; port >= 5173; port--) {
          try {
            const { stdout } = await execAsync(`lsof -ti:${port} 2>/dev/null`);
            if (stdout && stdout.trim()) {
              // Verificar que sea un proceso de node/vite
              const pid = stdout.trim();
              const { stdout: processInfo } = await execAsync(`ps -p ${pid} -o comm= 2>/dev/null`).catch(() => ({ stdout: '' }));
              if (processInfo && (processInfo.includes('node') || processInfo.includes('vite'))) {
                // Verificar que esté escuchando en ese puerto
                const { stdout: listenCheck } = await execAsync(`lsof -i :${port} 2>/dev/null | grep LISTEN`).catch(() => ({ stdout: '' }));
                if (listenCheck && listenCheck.includes('LISTEN')) {
                  actualPort = port;
                  console.log(`   ✅ Detectado que Vite está usando puerto ${actualPort}`);
                  break;
                }
              }
            }
          } catch {
            continue;
          }
        }
        
        if (actualPort === FRONTEND_PORT) {
          console.log(`   ℹ️  Usando puerto por defecto ${actualPort}`);
        }
      } catch (err) {
        console.log(`   ⚠️  No se pudo detectar el puerto, usando ${actualPort}`);
        console.log(`   💡 Si no funciona, verifica manualmente en qué puerto está Vite`);
      }
      
      // Intentar usar cloudflared primero (sin página de protección)
      let useCloudflared = false;
      try {
        await execAsync('which cloudflared');
        useCloudflared = true;
        console.log('   ✅ cloudflared encontrado (sin página de protección)');
      } catch {
        console.log('   ⚠️  cloudflared no encontrado');
        console.log('   💡 Para evitar la página de protección, instala cloudflared:');
        console.log('      sudo chown -R $(whoami) /usr/local/share/man/man8');
        console.log('      chmod u+w /usr/local/share/man/man8');
        console.log('      brew install cloudflared');
        console.log('   📝 Por ahora usando localtunnel (tendrás que hacer clic en "Click to Submit")');
      }
      
      if (useCloudflared) {
        // Usar cloudflared con el puerto correcto
        const cloudflared = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${actualPort}`], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let tunnelUrl = '';
        let urlFound = false;
        
        // Cloudflared puede escribir en stdout o stderr
        const handleOutput = (data, source) => {
          const output = data.toString();
          if (!urlFound) {
            // Buscar la URL en diferentes formatos
            const urlPatterns = [
              /https:\/\/[a-z0-9-]+\.trycloudflare\.com/g,
              /https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?/g,
              /(https?:\/\/[^\s]+trycloudflare[^\s]+)/g
            ];
            
            for (const pattern of urlPatterns) {
              const matches = output.match(pattern);
              if (matches && matches.length > 0) {
                tunnelUrl = matches[0].replace(/\/$/, ''); // Remover trailing slash
                urlFound = true;
                console.log('\n✅ Túnel creado exitosamente!');
                console.log('📱 URL para acceder desde tu iPhone:');
                console.log('   ', tunnelUrl);
                console.log('\n💡 Esta URL funciona con HTTPS y NO tiene página de protección');
                console.log('⚠️  Presiona Ctrl+C para cerrar el túnel y los servidores\n');
                break;
              }
            }
          }
          
          // Mostrar toda la salida para debugging
          if (source === 'stdout') {
            process.stdout.write(output);
          } else {
            process.stderr.write(output);
          }
        };
        
        cloudflared.stdout.on('data', (data) => handleOutput(data, 'stdout'));
        cloudflared.stderr.on('data', (data) => handleOutput(data, 'stderr'));
        
        cloudflared.on('close', (code) => {
          console.log('\n🔌 Túnel cerrado');
          process.exit(0);
        });
      } else {
        // Usar localtunnel como fallback
        const localtunnel = (await import('localtunnel')).default;
        let tunnel;
        try {
          tunnel = await localtunnel({ port: actualPort });
          console.log(`   Túnel creado para puerto ${actualPort}`);
        } catch (err) {
          console.log(`   Puerto ${actualPort} no disponible, intentando 5174...`);
          tunnel = await localtunnel({ port: 5174 });
          console.log(`   Túnel creado para puerto 5174`);
        }
        
        console.log('\n✅ Túnel creado exitosamente!');
        console.log('📱 URL para acceder desde tu iPhone:');
        console.log('   ', tunnel.url);
        console.log('\n💡 Esta URL funciona con HTTPS');
        console.log('⚠️  IMPORTANTE: Si ves una página pidiendo contraseña:');
        console.log('   1. NO escribas nada en el campo de contraseña');
        console.log('   2. Simplemente haz clic en "Click to Submit" (botón azul)');
        console.log('   3. Debería funcionar sin contraseña');
        console.log('\n💡 Para evitar esta página en el futuro, instala cloudflared:');
        console.log('   sudo chown -R $(whoami) /usr/local/share/man/man8');
        console.log('   chmod u+w /usr/local/share/man/man8');
        console.log('   brew install cloudflared');
        console.log('\n⚠️  Presiona Ctrl+C para cerrar el túnel y los servidores\n');

        tunnel.on('close', () => {
          console.log('\n🔌 Túnel cerrado');
          process.exit(0);
        });
      }
    } catch (err) {
      console.error('❌ Error creando túnel:', err);
      console.log('\n💡 Puedes acceder localmente en: http://10.101.1.124:5173/indev');
    }
  }, 5000);
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

