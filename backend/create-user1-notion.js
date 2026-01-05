/**
 * Script para crear la página de Notion y el tab para el usuario número 1
 * 
 * Uso:
 * node backend/create-user1-notion.js
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import supabase from './config/database.js';
import { createNotionPage } from './services/notion.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cargar .env
dotenv.config({ path: join(__dirname, '../.env') });

// Database ID de usuarios en Notion
const USERS_DATABASE_ID = 'f83a58c704884895af4cbe38715c8d7b';

async function createUser1Notion() {
  try {
    const apiKey = process.env.NOTION_API_KEY;

    if (!apiKey) {
      console.error('❌ Error: NOTION_API_KEY no está configurado en .env');
      process.exit(1);
    }

    console.log('🔍 Buscando usuario número 1...\n');

    // Buscar usuario con id = 1, o el primer usuario creado
    const { data: user1, error: userError } = await supabase
      .from('users')
      .select('id, email, name, created_at')
      .eq('id', 1)
      .single();

    if (userError || !user1) {
      // Si no existe id=1, buscar el primer usuario por fecha de creación
      console.log('⚠️  Usuario con id=1 no encontrado, buscando primer usuario...');
      const { data: firstUser, error: firstError } = await supabase
        .from('users')
        .select('id, email, name, created_at')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      if (firstError || !firstUser) {
        console.error('❌ Error: No se encontró ningún usuario');
        process.exit(1);
      }

      console.log(`✅ Usuario encontrado: ${firstUser.name || firstUser.email} (ID: ${firstUser.id})\n`);
      await processUser(firstUser, apiKey);
    } else {
      console.log(`✅ Usuario encontrado: ${user1.name || user1.email} (ID: ${user1.id})\n`);
      await processUser(user1, apiKey);
    }

  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  }
}

async function processUser(user, apiKey) {
  const userName = user.name || user.email.split('@')[0];
  
  console.log(`👤 Procesando usuario: ${userName} (${user.email})`);
  console.log(`   ID: ${user.id}\n`);

  // Verificar si ya tiene un tab de Notion
  const { data: existingTabs } = await supabase
    .from('tabs')
    .select('id, url, title')
    .eq('user_id', user.id)
    .is('space_id', null);

  // Verificar si algún tab es una URL de Notion
  const hasNotionTab = existingTabs?.some(tab => 
    tab.url && (tab.url.includes('notion.so') || tab.url.includes('notion.com'))
  );

  if (hasNotionTab) {
    console.log('⚠️  El usuario ya tiene un tab de Notion:');
    existingTabs?.forEach(tab => {
      if (tab.url && (tab.url.includes('notion.so') || tab.url.includes('notion.com'))) {
        console.log(`   - Tab ID: ${tab.id}, URL: ${tab.url}`);
      }
    });
    console.log('\n¿Deseas crear otro tab? (Este script creará uno nuevo de todas formas)\n');
  }

  try {
    // Crear página en Notion
    console.log('📄 Creando página en Notion...');
    console.log(`   Database ID: ${USERS_DATABASE_ID}`);
    console.log(`   Nombre: ${userName}`);
    
    const notionPage = await createNotionPage(
      apiKey,
      USERS_DATABASE_ID,
      userName
    );
    
    console.log(`✅ Página creada en Notion:`);
    console.log(`   URL: ${notionPage.url}`);
    console.log(`   Page ID: ${notionPage.id}\n`);

    // Crear tab
    console.log('📑 Creando tab...');
    const { data: newTab, error: tabError } = await supabase
      .from('tabs')
      .insert({
        user_id: user.id,
        title: userName,
        url: notionPage.url,
        is_expanded: true
      })
      .select('*')
      .single();

    if (tabError) {
      console.error('❌ Error creando tab:', tabError.message);
      console.error('   Detalles:', JSON.stringify(tabError, null, 2));
      process.exit(1);
    }

    console.log('✅ Tab creado exitosamente:');
    console.log(`   Tab ID: ${newTab.id}`);
    console.log(`   Título: ${newTab.title}`);
    console.log(`   URL: ${newTab.url}`);
    console.log(`   Expandido: ${newTab.is_expanded ? 'Sí' : 'No'}\n`);

    console.log('✨ Proceso completado exitosamente!');
    console.log(`\n📝 Resumen:`);
    console.log(`   Usuario: ${userName} (${user.email})`);
    console.log(`   Página Notion: ${notionPage.url}`);
    console.log(`   Tab creado: ${newTab.id}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Ejecutar script
createUser1Notion()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });


