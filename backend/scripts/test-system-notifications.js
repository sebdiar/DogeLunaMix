/**
 * Script para probar notificaciones push de mensajes del sistema
 * 
 * Uso:
 * 1. Obtén tu token de autenticación (desde el frontend o Postman)
 * 2. Ejecuta este script con: node backend/scripts/test-system-notifications.js
 * 
 * O usa curl/Postman para probar los endpoints directamente:
 * 
 * Endpoint 1: Enviar notificación push de prueba directa
 * POST /api/notifications/test/system
 * Headers: { Authorization: "Bearer YOUR_TOKEN" }
 * Body (opcional): { "title": "Custom Title", "body": "Custom message" }
 * 
 * Endpoint 2: Crear mensaje del sistema en un chat y enviar notificación
 * POST /api/chat/test/system-message
 * Headers: { Authorization: "Bearer YOUR_TOKEN" }
 * Body: { "chatId": "YOUR_CHAT_ID", "message": "Mensaje de prueba opcional" }
 */

import fetch from 'node-fetch';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

async function testSystemNotification() {
  console.log('🧪 Testing system notification push...\n');
  
  if (!AUTH_TOKEN) {
    console.error('❌ Error: AUTH_TOKEN environment variable is required');
    console.log('\n💡 Set it with: export AUTH_TOKEN="your-token-here"');
    return;
  }
  
  try {
    // Test 1: Direct push notification
    console.log('📤 Test 1: Sending direct system push notification...');
    const response1 = await fetch(`${API_BASE_URL}/api/notifications/test/system`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'System',
        body: `🧪 Test system notification - ${new Date().toLocaleString()}`
      })
    });
    
    const result1 = await response1.json();
    
    if (response1.ok) {
      console.log('✅ Test 1 passed:', result1);
    } else {
      console.error('❌ Test 1 failed:', result1);
    }
    
    console.log('\n');
    
    // Test 2: System message in chat (requires chatId)
    const CHAT_ID = process.env.CHAT_ID;
    if (CHAT_ID) {
      console.log('📤 Test 2: Creating system message in chat and sending notification...');
      const response2 = await fetch(`${API_BASE_URL}/api/chat/test/system-message`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AUTH_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chatId: CHAT_ID,
          message: `🧪 Test system message - ${new Date().toLocaleString()}`
        })
      });
      
      const result2 = await response2.json();
      
      if (response2.ok) {
        console.log('✅ Test 2 passed:', result2);
      } else {
        console.error('❌ Test 2 failed:', result2);
      }
    } else {
      console.log('⏭️  Test 2 skipped: CHAT_ID not provided');
      console.log('💡 Set it with: export CHAT_ID="your-chat-id"');
    }
    
  } catch (error) {
    console.error('❌ Error running tests:', error);
  }
}

// Run tests
testSystemNotification();

