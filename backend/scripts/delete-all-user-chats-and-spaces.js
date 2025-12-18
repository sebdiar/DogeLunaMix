/**
 * Script para borrar TODOS los chats y espacios de usuario
 * 
 * Ejecutar con: node backend/scripts/delete-all-user-chats-and-spaces.js
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function deleteAllUserChatsAndSpaces() {
  console.log('🗑️  Borrando TODOS los chats y espacios de usuario...\n');

  try {
    // 1. Obtener todos los espacios de usuario
    const { data: userSpaces, error: spacesError } = await supabase
      .from('spaces')
      .select('id, user_id, name')
      .eq('category', 'user');

    if (spacesError) {
      console.error('❌ Error al obtener espacios de usuario:', spacesError);
      process.exit(1);
    }

    if (!userSpaces || userSpaces.length === 0) {
      console.log('✅ No hay espacios de usuario para borrar.');
    } else {
      console.log(`📊 Encontrados ${userSpaces.length} espacios de usuario.\n`);
    }

    // 2. Obtener todos los chats asociados a espacios de usuario
    const spaceIds = userSpaces?.map(s => s.id) || [];
    let chatIds = new Set();

    if (spaceIds.length > 0) {
      const { data: spaceChats, error: spaceChatsError } = await supabase
        .from('space_chats')
        .select('chat_id')
        .in('space_id', spaceIds);

      if (spaceChatsError) {
        console.error('❌ Error al obtener space_chats:', spaceChatsError);
        process.exit(1);
      }

      spaceChats?.forEach(sc => chatIds.add(sc.chat_id));
      console.log(`📊 Encontrados ${chatIds.size} chats asociados a espacios de usuario.`);
    }

    // 3. Eliminar en orden correcto (respetando foreign keys)
    console.log('\n🗑️  Eliminando datos...\n');

    let deletedCount = 0;

    // Delete space_chats
    if (spaceIds.length > 0) {
      const { error: spaceChatsError } = await supabase
        .from('space_chats')
        .delete()
        .in('space_id', spaceIds);
      
      if (spaceChatsError) {
        console.error('❌ Error eliminando space_chats:', spaceChatsError);
      } else {
        console.log(`✅ Eliminados space_chats`);
        deletedCount++;
      }
    }

    // Delete chat_message_reads
    if (chatIds.size > 0) {
      const { error: readsError } = await supabase
        .from('chat_message_reads')
        .delete()
        .in('chat_id', Array.from(chatIds));
      
      if (readsError) {
        console.error('❌ Error eliminando chat_message_reads:', readsError);
      } else {
        console.log(`✅ Eliminados chat_message_reads`);
        deletedCount++;
      }
    }

    // Delete chat_messages
    if (chatIds.size > 0) {
      const { error: messagesError } = await supabase
        .from('chat_messages')
        .delete()
        .in('chat_id', Array.from(chatIds));
      
      if (messagesError) {
        console.error('❌ Error eliminando chat_messages:', messagesError);
      } else {
        console.log(`✅ Eliminados chat_messages`);
        deletedCount++;
      }
    }

    // Delete chat_participants
    if (chatIds.size > 0) {
      const { error: participantsError } = await supabase
        .from('chat_participants')
        .delete()
        .in('chat_id', Array.from(chatIds));
      
      if (participantsError) {
        console.error('❌ Error eliminando chat_participants:', participantsError);
      } else {
        console.log(`✅ Eliminados chat_participants`);
        deletedCount++;
      }
    }

    // Delete chats
    if (chatIds.size > 0) {
      const { error: chatsError } = await supabase
        .from('chats')
        .delete()
        .in('id', Array.from(chatIds));
      
      if (chatsError) {
        console.error('❌ Error eliminando chats:', chatsError);
      } else {
        console.log(`✅ Eliminados ${chatIds.size} chats`);
        deletedCount++;
      }
    }

    // Delete tabs
    if (spaceIds.length > 0) {
      const { error: tabsError } = await supabase
        .from('tabs')
        .delete()
        .in('space_id', spaceIds);
      
      if (tabsError) {
        console.error('❌ Error eliminando tabs:', tabsError);
      } else {
        console.log(`✅ Eliminados tabs`);
        deletedCount++;
      }
    }

    // Delete spaces
    if (spaceIds.length > 0) {
      const { error: spacesDeleteError } = await supabase
        .from('spaces')
        .delete()
        .in('id', spaceIds);
      
      if (spacesDeleteError) {
        console.error('❌ Error eliminando spaces:', spacesDeleteError);
      } else {
        console.log(`✅ Eliminados ${spaceIds.length} espacios de usuario`);
        deletedCount++;
      }
    }

    console.log(`\n✨ Proceso completado! ${deletedCount} operaciones realizadas.`);
    console.log(`📊 Resumen:`);
    console.log(`   - ${spaceIds.length} espacios eliminados`);
    console.log(`   - ${chatIds.size} chats eliminados`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  }
}

deleteAllUserChatsAndSpaces();

