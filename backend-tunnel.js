#!/usr/bin/env node
/**
 * Script para crear un túnel HTTPS solo para el backend (puerto 3001)
 * Para debugging de webhooks de Notion
 */

import { spawn } from 'child_process';

const BACKEND_PORT = process.env.BACKEND_PORT || 3001;

console.log('🔗 Creando túnel HTTPS para backend en puerto', BACKEND_PORT);
console.log('💡 Asegúrate de que el backend esté corriendo en ese puerto\n');

// Usar cloudflared (sin página de protección)
const cloudflared = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${BACKEND_PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe']
});

let tunnelUrl = '';
let urlFound = false;

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
        console.log('🌐 URL del backend (para webhook de Notion):');
        console.log('   ', tunnelUrl + '/api/notion/webhook');
        console.log('\n📝 Copia esta URL y úsala en la configuración del webhook de Notion');
        console.log('💡 El backend debe estar corriendo localmente en puerto', BACKEND_PORT);
        console.log('⚠️  Presiona Ctrl+C para cerrar el túnel\n');
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

cloudflared.on('error', (err) => {
  console.error('❌ Error ejecutando cloudflared:', err);
  console.log('\n💡 Asegúrate de que cloudflared esté instalado:');
  console.log('   brew install cloudflared');
  process.exit(1);
});

// Manejar cierre
process.on('SIGINT', () => {
  console.log('\n🛑 Cerrando túnel...');
  cloudflared.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Cerrando túnel...');
  cloudflared.kill();
  process.exit(0);
});
