/**
 * Script para consolidar chats de usuarios (DMs)
 * Encuentra chats duplicados entre dos usuarios y los consolida en uno solo
 * 
 * Ejecutar con: node backend/scripts/consolidate-user-chats.js
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function consolidateUserChats() {
  console.log('🔍 Buscando chats duplicados entre usuarios...\n');

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

    if (!userSpaces || userSpaces.length === 0) {
      console.log('✅ No se encontraron espacios de usuario.');
      return;
    }

    console.log(`📊 Encontrados ${userSpaces.length} espacios de usuario.\n`);

    // 2. Obtener todos los chats de estos espacios
    const spaceIds = userSpaces.map(s => s.id);
    const { data: spaceChats, error: spaceChatsError } = await supabase
      .from('space_chats')
      .select('space_id, chat_id')
      .in('space_id', spaceIds);

    if (spaceChatsError) {
      console.error('❌ Error al obtener space_chats:', spaceChatsError);
      process.exit(1);
    }

    // 3. Agrupar espacios por chat_id para encontrar duplicados
    const chatToSpaces = new Map();
    spaceChats.forEach(sc => {
      if (!chatToSpaces.has(sc.chat_id)) {
        chatToSpaces.set(sc.chat_id, []);
      }
      chatToSpaces.get(sc.chat_id).push(sc.space_id);
    });

    // 4. Para cada chat, verificar si hay múltiples espacios de usuario
    // Si hay múltiples espacios, verificar si son entre los mismos dos usuarios
    const duplicates = [];
    const processedPairs = new Set();

    for (const [chatId, spaceIdsForChat] of chatToSpaces.entries()) {
      if (spaceIdsForChat.length > 1) {
        // Hay múltiples espacios con el mismo chat - esto está bien si son del mismo par de usuarios
        // Pero necesitamos verificar si hay chats separados para el mismo par de usuarios
        const spacesForChat = userSpaces.filter(s => spaceIdsForChat.includes(s.id));
        
        // Obtener participantes del chat
        const { data: participants } = await supabase
          .from('chat_participants')
          .select('user_id')
          .eq('chat_id', chatId);
        
        if (participants && participants.length === 2) {
          const userIds = participants.map(p => p.user_id).sort();
          const pairKey = `${userIds[0]}-${userIds[1]}`;
          
          if (!processedPairs.has(pairKey)) {
            processedPairs.add(pairKey);
            
            // Buscar otros chats entre estos dos usuarios
            const { data: otherChats } = await supabase
              .from('chat_participants')
              .select('chat_id')
              .eq('user_id', userIds[0]);
            
            if (otherChats) {
              const otherChatIds = otherChats.map(c => c.chat_id);
              const { data: sharedChats } = await supabase
                .from('chat_participants')
                .select('chat_id')
                .in('chat_id', otherChatIds)
                .eq('user_id', userIds[1]);
              
              if (sharedChats && sharedChats.length > 1) {
                // Hay múltiples chats entre estos dos usuarios - necesitamos consolidar
                const chatIdsToConsolidate = sharedChats.map(c => c.chat_id);
                duplicates.push({
                  userIds,
                  chatIds: chatIdsToConsolidate,
                  keepChatId: chatId // Mantener el primero encontrado
                });
              }
            }
          }
        }
      }
    }

    if (duplicates.length === 0) {
      console.log('✅ No se encontraron chats duplicados entre usuarios.');
      return;
    }

    console.log(`📊 Encontrados ${duplicates.length} pares de usuarios con chats duplicados.\n`);

    let consolidated = 0;
    let errors = 0;

    // 5. Consolidar chats duplicados
    for (const duplicate of duplicates) {
      try {
        const { userIds, chatIds, keepChatId } = duplicate;
        const chatsToMerge = chatIds.filter(id => id !== keepChatId);

        if (chatsToMerge.length === 0) continue;

        console.log(`🔄 Consolidando chats para usuarios ${userIds[0]} y ${userIds[1]}`);
        console.log(`   Manteniendo chat: ${keepChatId}`);
        console.log(`   Fusionando chats: ${chatsToMerge.join(', ')}`);

        // Para cada chat a fusionar:
        for (const chatIdToMerge of chatsToMerge) {
          // 1. Mover todos los mensajes al chat que mantenemos
          const { error: updateMessagesError } = await supabase
            .from('chat_messages')
            .update({ chat_id: keepChatId })
            .eq('chat_id', chatIdToMerge);

          if (updateMessagesError) {
            console.error(`   ❌ Error moviendo mensajes:`, updateMessagesError);
            errors++;
            continue;
          }

          // 2. Mover todos los space_chats al chat que mantenemos
          const { data: spaceChatsToUpdate } = await supabase
            .from('space_chats')
            .select('space_id')
            .eq('chat_id', chatIdToMerge);

          if (spaceChatsToUpdate) {
            for (const sc of spaceChatsToUpdate) {
              // Verificar si ya existe space_chat para este space_id y keepChatId
              const { data: existing } = await supabase
                .from('space_chats')
                .select('id')
                .eq('space_id', sc.space_id)
                .eq('chat_id', keepChatId)
                .maybeSingle();

              if (!existing) {
                // Actualizar space_chat para apuntar al chat consolidado
                await supabase
                  .from('space_chats')
                  .update({ chat_id: keepChatId })
                  .eq('space_id', sc.space_id)
                  .eq('chat_id', chatIdToMerge);
              } else {
                // Ya existe - eliminar el duplicado
                await supabase
                  .from('space_chats')
                  .delete()
                  .eq('space_id', sc.space_id)
                  .eq('chat_id', chatIdToMerge);
              }
            }
          }

          // 3. Mover chat_message_reads al chat que mantenemos
          const { data: readsToUpdate } = await supabase
            .from('chat_message_reads')
            .select('user_id')
            .eq('chat_id', chatIdToMerge);

          if (readsToUpdate) {
            for (const read of readsToUpdate) {
              // Verificar si ya existe read para este user_id y keepChatId
              const { data: existing } = await supabase
                .from('chat_message_reads')
                .select('id')
                .eq('chat_id', keepChatId)
                .eq('user_id', read.user_id)
                .maybeSingle();

              if (!existing) {
                // Actualizar chat_message_reads
                await supabase
                  .from('chat_message_reads')
                  .update({ chat_id: keepChatId })
                  .eq('chat_id', chatIdToMerge)
                  .eq('user_id', read.user_id);
              } else {
                // Ya existe - eliminar el duplicado
                await supabase
                  .from('chat_message_reads')
                  .delete()
                  .eq('chat_id', chatIdToMerge)
                  .eq('user_id', read.user_id);
              }
            }
          }

          // 4. Eliminar chat_participants del chat a fusionar (ya están en keepChatId)
          await supabase
            .from('chat_participants')
            .delete()
            .eq('chat_id', chatIdToMerge);

          // 5. Eliminar el chat duplicado
          await supabase
            .from('chats')
            .delete()
            .eq('id', chatIdToMerge);

          console.log(`   ✅ Chat ${chatIdToMerge} fusionado exitosamente`);
        }

        consolidated++;
      } catch (error) {
        console.error(`   ❌ Error consolidando chats:`, error);
        errors++;
      }
    }

    console.log('\n📊 Resumen:');
    console.log(`   ✅ Consolidados: ${consolidated}`);
    console.log(`   ❌ Errores: ${errors}`);
    console.log(`   📦 Total procesados: ${duplicates.length}`);

  } catch (error) {
    console.error('❌ Error general:', error);
    process.exit(1);
  }
}

// Ejecutar el script
consolidateUserChats()
  .then(() => {
    console.log('\n✅ Script completado.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  });

