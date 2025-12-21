#!/usr/bin/env node
/**
 * Script para desarrollo frontend local con túnel para mobile testing
 */

import { spawn } from 'child_process';

const FRONTEND_PORT = 5173;

console.log('🚀 Iniciando frontend local con túnel para mobile...\n');

// Iniciar frontend
console.log('🌐 Iniciando frontend en puerto', FRONTEND_PORT);
const frontend = spawn('npm', ['run', 'dev'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: true
});

frontend.on('error', (err) => {
  console.error('❌ Error iniciando frontend:', err);
});

// Esperar a que el frontend esté listo y crear túnel
setTimeout(async () => {
  try {
    console.log('\n🔗 Creando túnel HTTPS para frontend...');
    
    // Usar cloudflared (sin página de protección)
    const cloudflared = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${FRONTEND_PORT}`], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let tunnelUrl = '';
    let urlFound = false;
    
    const handleOutput = (data, source) => {
      const output = data.toString();
      
      if (!urlFound) {
        const urlPatterns = [
          /https:\/\/[a-z0-9-]+\.trycloudflare\.com/g,
          /https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?/g,
          /(https?:\/\/[^\s]+trycloudflare[^\s]+)/g
        ];
        
        for (const pattern of urlPatterns) {
          const matches = output.match(pattern);
          if (matches && matches.length > 0) {
            tunnelUrl = matches[0].replace(/\/$/, '');
            urlFound = true;
            console.log('\n✅ Túnel creado exitosamente!');
            console.log('📱 URL para acceder desde tu iPhone:');
            console.log('   ', tunnelUrl);
            console.log('\n💡 Esta URL funciona con HTTPS y NO tiene página de protección');
            console.log('⚠️  Presiona Ctrl+C para cerrar el túnel y el servidor\n');
            break;
          }
        }
      }
      
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
    
    cloudflared.on('error', (err) => {
      console.error('❌ Error ejecutando cloudflared:', err);
      console.log('\n💡 Asegúrate de que cloudflared esté instalado:');
      console.log('   brew install cloudflared');
      process.exit(1);
    });
  } catch (err) {
    console.error('❌ Error creando túnel:', err);
  }
}, 3000);

// Manejar cierre
process.on('SIGINT', () => {
  console.log('\n🛑 Cerrando servidores...');
  frontend.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Cerrando servidores...');
  frontend.kill();
  process.exit(0);
});


