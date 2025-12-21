/**
 * Script para verificar qué chats hay antes de borrar
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkChats() {
  console.log('🔍 Verificando chats y espacios de usuario...\n');

  try {
    // 1. Obtener todos los espacios de usuario
    const { data: userSpaces, error: spacesError } = await supabase
      .from('spaces')
      .select('id, user_id, name, category')
      .eq('category', 'user')
      .eq('archived', false);

    if (spacesError) {
      console.error('❌ Error al obtener espacios de usuario:', spacesError);
      process.exit(1);
    }

    console.log(`📊 Espacios de usuario encontrados: ${userSpaces?.length || 0}\n`);

    if (userSpaces && userSpaces.length > 0) {
      const spaceIds = userSpaces.map(s => s.id);
      
      // 2. Obtener todos los space_chats de estos espacios
      const { data: spaceChats, error: spaceChatsError } = await supabase
        .from('space_chats')
        .select('space_id, chat_id')
        .in('space_id', spaceIds);

      if (spaceChatsError) {
        console.error('❌ Error al obtener space_chats:', spaceChatsError);
        process.exit(1);
      }

      console.log(`📊 space_chats encontrados: ${spaceChats?.length || 0}`);
      
      if (spaceChats && spaceChats.length > 0) {
        const chatIds = [...new Set(spaceChats.map(sc => sc.chat_id))];
        console.log(`📊 Chats únicos asociados a espacios: ${chatIds.length}\n`);

        // Mostrar detalles
        console.log('📋 Detalles:\n');
        for (const space of userSpaces) {
          const spaceChatsForSpace = spaceChats.filter(sc => sc.space_id === space.id);
          console.log(`   Espacio "${space.name}" (${space.id}):`);
          console.log(`     - space_chats: ${spaceChatsForSpace.length}`);
          spaceChatsForSpace.forEach(sc => {
            console.log(`       * Chat ID: ${sc.chat_id}`);
          });
        }

        // Verificar si hay chats huérfanos (chats sin espacios)
        const { data: allChats, error: allChatsError } = await supabase
          .from('chats')
          .select('id');

        if (!allChatsError && allChats) {
          const allChatIds = allChats.map(c => c.id);
          const orphanChats = allChatIds.filter(chatId => !chatIds.includes(chatId));
          
          if (orphanChats.length > 0) {
            console.log(`\n⚠️  Chats huérfanos (sin espacios asociados): ${orphanChats.length}`);
            console.log(`   IDs: ${orphanChats.slice(0, 10).join(', ')}${orphanChats.length > 10 ? '...' : ''}`);
          }
        }
      } else {
        console.log('📊 No hay space_chats asociados a estos espacios.\n');
      }
    } else {
      console.log('📊 No hay espacios de usuario.\n');
    }

  } catch (error) {
    console.error('❌ Error general:', error);
    process.exit(1);
  }
}

checkChats()
  .then(() => {
    console.log('\n✅ Script completado.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  });


