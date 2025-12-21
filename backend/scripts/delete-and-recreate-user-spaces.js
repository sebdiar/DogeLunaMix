/**
 * Script para borrar todos los espacios de usuario (DMs) y recrearlos correctamente
 * Esto asegura que cada par de usuarios tenga un solo chat compartido
 * 
 * Ejecutar con: node backend/scripts/delete-and-recreate-user-spaces.js
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function deleteAndRecreateUserSpaces() {
  console.log('🗑️  Borrando todos los espacios de usuario y sus chats...\n');

  try {
    // 1. Obtener todos los espacios de usuario
    const { data: userSpaces, error: spacesError } = await supabase
      .from('spaces')
      .select('id, user_id, name')
      .eq('category', 'user')
      .eq('archived', false);

    if (spacesError) {
      console.error('❌ Error al obtener espacios de usuario:', spacesError);
      process.exit(1);
    }

    if (!userSpaces || userSpaces.length === 0) {
      console.log('✅ No hay espacios de usuario para borrar.');
      return;
    }

    console.log(`📊 Encontrados ${userSpaces.length} espacios de usuario.\n`);

    // 2. Obtener todos los chats asociados a estos espacios
    const spaceIds = userSpaces.map(s => s.id);
    const { data: spaceChats, error: spaceChatsError } = await supabase
      .from('space_chats')
      .select('chat_id')
      .in('space_id', spaceIds);

    if (spaceChatsError) {
      console.error('❌ Error al obtener space_chats:', spaceChatsError);
      process.exit(1);
    }

    const chatIds = [...new Set(spaceChats.map(sc => sc.chat_id))];
    console.log(`📊 Encontrados ${chatIds.length} chats únicos.\n`);

    // 3. Borrar en orden correcto (respetando foreign keys)
    console.log('🗑️  Borrando space_chats...');
    const { error: deleteSpaceChatsError } = await supabase
      .from('space_chats')
      .delete()
      .in('space_id', spaceIds);

    if (deleteSpaceChatsError) {
      console.error('❌ Error borrando space_chats:', deleteSpaceChatsError);
      process.exit(1);
    }

    console.log('🗑️  Borrando chat_participants...');
    if (chatIds.length > 0) {
      const { error: deleteParticipantsError } = await supabase
        .from('chat_participants')
        .delete()
        .in('chat_id', chatIds);

      if (deleteParticipantsError) {
        console.error('❌ Error borrando chat_participants:', deleteParticipantsError);
        process.exit(1);
      }
    }

    console.log('🗑️  Borrando chat_messages...');
    if (chatIds.length > 0) {
      const { error: deleteMessagesError } = await supabase
        .from('chat_messages')
        .delete()
        .in('chat_id', chatIds);

      if (deleteMessagesError) {
        console.error('❌ Error borrando chat_messages:', deleteMessagesError);
        process.exit(1);
      }
    }

    console.log('🗑️  Borrando chat_message_reads...');
    if (chatIds.length > 0) {
      const { error: deleteReadsError } = await supabase
        .from('chat_message_reads')
        .delete()
        .in('chat_id', chatIds);

      if (deleteReadsError) {
        console.error('❌ Error borrando chat_message_reads:', deleteReadsError);
        // No es crítico si falla (puede que no exista la tabla)
      }
    }

    console.log('🗑️  Borrando chats...');
    if (chatIds.length > 0) {
      const { error: deleteChatsError } = await supabase
        .from('chats')
        .delete()
        .in('id', chatIds);

      if (deleteChatsError) {
        console.error('❌ Error borrando chats:', deleteChatsError);
        process.exit(1);
      }
    }

    console.log('🗑️  Borrando tabs de espacios de usuario...');
    const { error: deleteTabsError } = await supabase
      .from('tabs')
      .delete()
      .in('space_id', spaceIds);

    if (deleteTabsError) {
      console.error('❌ Error borrando tabs:', deleteTabsError);
      process.exit(1);
    }

    console.log('🗑️  Borrando espacios de usuario...');
    const { error: deleteSpacesError } = await supabase
      .from('spaces')
      .delete()
      .in('id', spaceIds);

    if (deleteSpacesError) {
      console.error('❌ Error borrando espacios:', deleteSpacesError);
      process.exit(1);
    }

    console.log('✅ Todos los espacios de usuario y chats han sido borrados.\n');
    console.log('📝 Los espacios de usuario se recrearán automáticamente cuando los usuarios');
    console.log('   abran chats entre ellos. Cada par de usuarios compartirá un solo chat.\n');

  } catch (error) {
    console.error('❌ Error general:', error);
    process.exit(1);
  }
}

// Ejecutar el script
deleteAndRecreateUserSpaces()
  .then(() => {
    console.log('✅ Script completado.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  });


