/**
 * Script para crear la página de Notion y el tab para el usuario con nombre "1"
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import supabase from './config/database.js';
import { createNotionPage } from './services/notion.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const USERS_DATABASE_ID = 'f83a58c704884895af4cbe38715c8d7b';

async function createUserNamed1() {
  try {
    const apiKey = process.env.NOTION_API_KEY;

    if (!apiKey) {
      console.error('❌ Error: NOTION_API_KEY no está configurado');
      process.exit(1);
    }

    console.log('🔍 Buscando usuario con nombre "1"...\n');

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, name, created_at')
      .eq('name', '1')
      .single();

    if (userError || !user) {
      console.error('❌ No se encontró usuario con nombre "1"');
      console.error('Error:', userError);
      process.exit(1);
    }

    console.log('✅ Usuario encontrado:');
    console.log(`   ID: ${user.id}`);
    console.log(`   Nombre: ${user.name}`);
    console.log(`   Email: ${user.email}\n`);

    // Verificar si ya tiene tab de Notion
    const { data: existingTabs } = await supabase
      .from('tabs')
      .select('id, url, title')
      .eq('user_id', user.id)
      .is('space_id', null);

    const hasNotionTab = existingTabs?.some(tab => 
      tab.url && (tab.url.includes('notion.so') || tab.url.includes('notion.com'))
    );

    if (hasNotionTab) {
      console.log('⚠️  El usuario ya tiene tab(s) de Notion:');
      existingTabs?.forEach(tab => {
        if (tab.url && (tab.url.includes('notion.so') || tab.url.includes('notion.com'))) {
          console.log(`   - Tab ID: ${tab.id}, URL: ${tab.url}`);
        }
      });
      console.log('');
    }

    // Crear página en Notion
    console.log('📄 Creando página en Notion...');
    console.log(`   Database ID: ${USERS_DATABASE_ID}`);
    console.log(`   Nombre: ${user.name}`);
    
    const notionPage = await createNotionPage(
      apiKey,
      USERS_DATABASE_ID,
      user.name
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
        title: user.name,
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
    console.log(`   URL: ${newTab.url}\n`);

    console.log('✨ Proceso completado!');
    console.log(`\n📝 Resumen:`);
    console.log(`   Usuario: ${user.name} (${user.email})`);
    console.log(`   Página Notion: ${notionPage.url}`);
    console.log(`   Tab ID: ${newTab.id}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

createUserNamed1()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });


