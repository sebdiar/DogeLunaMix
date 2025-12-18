/**
 * Script para borrar TODOS los chats de usuario, incluyendo huérfanos
 * 
 * Ejecutar con: node backend/scripts/delete-all-user-chats-complete.js
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function deleteAllUserChats() {
  console.log('🗑️  Borrando TODOS los chats de usuario (incluyendo huérfanos)...\n');

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
    } else {
      console.log(`📊 Encontrados ${userSpaces.length} espacios de usuario.\n`);
    }

    // 2. Obtener TODOS los chats (no solo los asociados a espacios)
    const { data: allChats, error: allChatsError } = await supabase
      .from('chats')
      .select('id');

    if (allChatsError) {
      console.error('❌ Error al obtener todos los chats:', allChatsError);
      process.exit(1);
    }

    const allChatIds = allChats?.map(c => c.id) || [];
    console.log(`📊 Total de chats en la base de datos: ${allChatIds.length}`);

    // 3. Obtener todos los space_chats
    const { data: allSpaceChats, error: allSpaceChatsError } = await supabase
      .from('space_chats')
      .select('chat_id, space_id');

    if (allSpaceChatsError) {
      console.error('❌ Error al obtener space_chats:', allSpaceChatsError);
      process.exit(1);
    }

    // Obtener todos los espacios para identificar categorías
    const spaceIds = allSpaceChats?.map(sc => sc.space_id) || [];
    const { data: allSpaces, error: allSpacesError } = await supabase
      .from('spaces')
      .select('id, category')
      .in('id', spaceIds.length > 0 ? spaceIds : ['00000000-0000-0000-0000-000000000000']); // Dummy ID si no hay espacios

    if (allSpacesError) {
      console.error('❌ Error al obtener espacios:', allSpacesError);
      process.exit(1);
    }

    // Crear mapa de space_id -> category
    const spaceCategoryMap = new Map();
    if (allSpaces) {
      allSpaces.forEach(s => {
        spaceCategoryMap.set(s.id, s.category);
      });
    }

    // Separar chats de proyectos y chats de usuarios
    const projectChatIds = new Set();
    const userChatIds = new Set();

    if (allSpaceChats) {
      for (const sc of allSpaceChats) {
        const category = spaceCategoryMap.get(sc.space_id);
        if (category === 'project') {
          projectChatIds.add(sc.chat_id);
        } else {
          userChatIds.add(sc.chat_id);
        }
      }
    }

    console.log(`📊 Chats asociados a proyectos: ${projectChatIds.size}`);
    console.log(`📊 Chats asociados a usuarios: ${userChatIds.size}`);
    console.log(`📊 Chats huérfanos (sin espacios): ${allChatIds.length - projectChatIds.size - userChatIds.size}\n`);

    // 4. Borrar solo chats de usuarios (no proyectos)
    const chatsToDelete = Array.from(userChatIds);
    
    if (chatsToDelete.length === 0) {
      console.log('✅ No hay chats de usuario para borrar.');
    } else {
      console.log(`🗑️  Borrando ${chatsToDelete.length} chats de usuario...\n`);

      // Borrar en orden correcto (respetando foreign keys)
      console.log('🗑️  Borrando space_chats de usuarios...');
      if (userSpaces && userSpaces.length > 0) {
        const spaceIds = userSpaces.map(s => s.id);
        const { error: deleteSpaceChatsError } = await supabase
          .from('space_chats')
          .delete()
          .in('space_id', spaceIds);

        if (deleteSpaceChatsError) {
          console.error('❌ Error borrando space_chats:', deleteSpaceChatsError);
          process.exit(1);
        }
      }

      console.log('🗑️  Borrando chat_participants...');
      const { error: deleteParticipantsError } = await supabase
        .from('chat_participants')
        .delete()
        .in('chat_id', chatsToDelete);

      if (deleteParticipantsError) {
        console.error('❌ Error borrando chat_participants:', deleteParticipantsError);
        process.exit(1);
      }

      console.log('🗑️  Borrando chat_messages...');
      const { error: deleteMessagesError } = await supabase
        .from('chat_messages')
        .delete()
        .in('chat_id', chatsToDelete);

      if (deleteMessagesError) {
        console.error('❌ Error borrando chat_messages:', deleteMessagesError);
        process.exit(1);
      }

      console.log('🗑️  Borrando chat_message_reads...');
      const { error: deleteReadsError } = await supabase
        .from('chat_message_reads')
        .delete()
        .in('chat_id', chatsToDelete);

      if (deleteReadsError) {
        console.error('❌ Error borrando chat_message_reads:', deleteReadsError);
        // No es crítico si falla (puede que no exista la tabla)
      }

      console.log('🗑️  Borrando chats...');
      const { error: deleteChatsError } = await supabase
        .from('chats')
        .delete()
        .in('id', chatsToDelete);

      if (deleteChatsError) {
        console.error('❌ Error borrando chats:', deleteChatsError);
        process.exit(1);
      }

      console.log('✅ Chats de usuario borrados.\n');
    }

    // 5. Borrar espacios de usuario
    if (userSpaces && userSpaces.length > 0) {
      const spaceIds = userSpaces.map(s => s.id);
      
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

      console.log('✅ Espacios de usuario borrados.\n');
    }

    console.log('✅ Todos los chats y espacios de usuario han sido borrados.\n');

  } catch (error) {
    console.error('❌ Error general:', error);
    process.exit(1);
  }
}

deleteAllUserChats()
  .then(() => {
    console.log('✅ Script completado.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  });

