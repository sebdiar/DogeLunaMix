/**
 * Script para crear tabs de Notion para usuarios existentes que no los tienen
 * 
 * Uso:
 * node backend/create-user-tabs.js
 * 
 * Este script:
 * 1. Busca todos los usuarios
 * 2. Para cada usuario, verifica si tiene un tab de Notion
 * 3. Si no lo tiene, crea la página en Notion y el tab
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

async function createUserTabs() {
  try {
    const apiKey = process.env.NOTION_API_KEY;
    const usersDatabaseId = process.env.NOTION_USERS_DATABASE_ID;

    if (!apiKey || !usersDatabaseId) {
      console.error('❌ Error: NOTION_API_KEY o NOTION_USERS_DATABASE_ID no están configurados en .env');
      console.log('\nAgrega estas variables a tu archivo .env:');
      console.log('NOTION_API_KEY=tu_api_key');
      console.log('NOTION_USERS_DATABASE_ID=tu_database_id');
      process.exit(1);
    }

    console.log('🔍 Buscando usuarios...\n');

    // Get all users
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, email, name');

    if (usersError) {
      console.error('❌ Error obteniendo usuarios:', usersError);
      process.exit(1);
    }

    if (!users || users.length === 0) {
      console.log('ℹ️  No hay usuarios en la base de datos');
      process.exit(0);
    }

    console.log(`📋 Encontrados ${users.length} usuario(s)\n`);

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const user of users) {
      const userName = user.name || user.email.split('@')[0];
      console.log(`👤 Procesando: ${userName} (${user.email})`);

      // Check if user already has a Notion tab
      const { data: existingTabs } = await supabase
        .from('tabs')
        .select('id, url, title')
        .eq('user_id', user.id)
        .is('space_id', null);

      // Check if any tab is a Notion URL
      const hasNotionTab = existingTabs?.some(tab => 
        tab.url && (tab.url.includes('notion.so') || tab.url.includes('notion.com'))
      );

      if (hasNotionTab) {
        console.log(`   ⏭️  Ya tiene un tab de Notion, saltando...\n`);
        skipped++;
        continue;
      }

      try {
        // Create Notion page
        console.log(`   📄 Creando página en Notion...`);
        const notionPage = await createNotionPage(
          apiKey,
          usersDatabaseId,
          userName
        );
        console.log(`   ✅ Página creada: ${notionPage.url}`);

        // Create tab
        console.log(`   📑 Creando tab...`);
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
          console.error(`   ❌ Error creando tab:`, tabError.message);
          errors++;
        } else {
          console.log(`   ✅ Tab creado exitosamente (ID: ${newTab.id})\n`);
          created++;
        }
      } catch (error) {
        console.error(`   ❌ Error:`, error.message);
        errors++;
        console.log('');
      }
    }

    console.log('\n📊 Resumen:');
    console.log(`   ✅ Creados: ${created}`);
    console.log(`   ⏭️  Saltados: ${skipped}`);
    console.log(`   ❌ Errores: ${errors}`);
    console.log(`   📋 Total: ${users.length}`);

  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  }
}

// Run script
createUserTabs()
  .then(() => {
    console.log('\n✨ Proceso completado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });

