/**
 * Script para verificar el usuario con ID = 1
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import supabase from './config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

async function checkUser1() {
  try {
    console.log('🔍 Buscando usuario con ID = 1...\n');

    const { data: user1, error: userError } = await supabase
      .from('users')
      .select('id, email, name, created_at')
      .eq('id', 1)
      .single();

    if (userError || !user1) {
      console.log('❌ No se encontró usuario con ID = 1');
      console.log('Error:', userError);
      
      // Listar todos los usuarios para ver cuáles hay
      const { data: allUsers } = await supabase
        .from('users')
        .select('id, email, name, created_at')
        .order('id', { ascending: true })
        .limit(10);
      
      console.log('\n📋 Usuarios encontrados (primeros 10):');
      allUsers?.forEach(user => {
        console.log(`   ID: ${user.id}, Nombre: ${user.name || user.email}`);
      });
      
      process.exit(1);
    }

    console.log('✅ Usuario con ID = 1 encontrado:');
    console.log(`   ID: ${user1.id}`);
    console.log(`   Nombre: ${user1.name || 'Sin nombre'}`);
    console.log(`   Email: ${user1.email}`);
    console.log(`   Creado: ${user1.created_at}`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkUser1();


