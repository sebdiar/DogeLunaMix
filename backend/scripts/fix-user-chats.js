/**
 * Script para consolidar chats de usuarios duplicados
 * Asegura que cada par de usuarios tenga un solo chat compartido
 * 
 * Ejecutar con: node backend/scripts/fix-user-chats.js
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function fixUserChats() {
  console.log('🔧 Consolidando chats de usuarios...\n');

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

    // 2. Obtener todos los usuarios
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, name, email');

    if (usersError) {
      console.error('❌ Error al obtener usuarios:', usersError);
      process.exit(1);
    }

    const userMap = new Map(users.map(u => [u.id, u]));

    // 3. Obtener todos los chats de estos espacios
    const spaceIds = userSpaces.map(s => s.id);
    const { data: spaceChats, error: spaceChatsError } = await supabase
      .from('space_chats')
      .select('space_id, chat_id')
      .in('space_id', spaceIds);

    if (spaceChatsError) {
      console.error('❌ Error al obtener space_chats:', spaceChatsError);
      process.exit(1);
    }

    // 4. Agrupar espacios por nombre (email/nombre del otro usuario)
    const spacesByName = new Map();
    userSpaces.forEach(space => {
      const key = space.name.toLowerCase().trim();
      if (!spacesByName.has(key)) {
        spacesByName.set(key, []);
      }
      spacesByName.get(key).push(space);
    });

    // 5. Para cada grupo de espacios con el mismo nombre, consolidar sus chats
    let fixed = 0;
    let errors = 0;

    for (const [name, spaces] of spacesByName.entries()) {
      if (spaces.length < 2) continue; // Solo procesar si hay múltiples espacios

      console.log(`\n🔧 Procesando espacios con nombre "${name}":`);
      spaces.forEach(space => {
        const owner = userMap.get(space.user_id);
        console.log(`   - Space ${space.id} (Owner: ${owner?.name || owner?.email || space.user_id})`);
      });

      // Encontrar el otro usuario (el que no es el owner de los espacios)
      const ownerIds = new Set(spaces.map(s => s.user_id));
      if (ownerIds.size !== 2) {
        console.log(`   ⚠️  No se puede determinar el par de usuarios (${ownerIds.size} owners diferentes)`);
        continue;
      }

      const [userId1, userId2] = Array.from(ownerIds);
      console.log(`   👥 Par de usuarios: ${userMap.get(userId1)?.name || userId1} <-> ${userMap.get(userId2)?.name || userId2}`);

      // Obtener todos los chats de estos espacios
      const chatsForSpaces = spaceChats.filter(sc => spaces.some(s => s.id === sc.space_id));
      const chatIds = [...new Set(chatsForSpaces.map(sc => sc.chat_id))];

      console.log(`   📊 Encontrados ${chatIds.length} chats únicos`);

      // Encontrar el chat que tiene ambos usuarios como participantes
      let sharedChatId = null;
      for (const chatId of chatIds) {
        const { data: participants } = await supabase
          .from('chat_participants')
          .select('user_id')
          .eq('chat_id', chatId);

        const participantIds = participants?.map(p => p.user_id) || [];
        const hasBothUsers = participantIds.includes(userId1) && participantIds.includes(userId2);

        if (hasBothUsers) {
          sharedChatId = chatId;
          console.log(`   ✅ Chat compartido encontrado: ${chatId}`);
          break;
        }
      }

      // Si no hay chat compartido, crear uno nuevo
      if (!sharedChatId) {
        console.log(`   ➕ Creando nuevo chat compartido...`);
        const { data: newChat, error: createError } = await supabase
          .from('chats')
          .insert({})
          .select('id')
          .single();

        if (createError || !newChat) {
          console.error(`   ❌ Error creando chat:`, createError);
          errors++;
          continue;
        }

        sharedChatId = newChat.id;

        // Agregar ambos usuarios como participantes
        await supabase
          .from('chat_participants')
          .insert([
            { chat_id: sharedChatId, user_id: userId1 },
            { chat_id: sharedChatId, user_id: userId2 }
          ]);

        console.log(`   ✅ Chat compartido creado: ${sharedChatId}`);
      }

      // Consolidar todos los espacios para usar el chat compartido
      for (const space of spaces) {
        const existingSpaceChat = spaceChats.find(sc => sc.space_id === space.id);
        
        if (existingSpaceChat && existingSpaceChat.chat_id === sharedChatId) {
          console.log(`   ✓ Space ${space.id} ya está usando el chat compartido`);
          continue;
        }

        // Si hay un space_chat existente con un chat diferente, mover mensajes
        if (existingSpaceChat && existingSpaceChat.chat_id !== sharedChatId) {
          const oldChatId = existingSpaceChat.chat_id;
          console.log(`   🔄 Moviendo mensajes del chat ${oldChatId} al chat compartido ${sharedChatId}...`);

          // Mover mensajes
          const { error: moveMessagesError } = await supabase
            .from('chat_messages')
            .update({ chat_id: sharedChatId })
            .eq('chat_id', oldChatId);

          if (moveMessagesError) {
            console.error(`   ❌ Error moviendo mensajes:`, moveMessagesError);
          }

          // Mover chat_message_reads
          const { data: readsToMove } = await supabase
            .from('chat_message_reads')
            .select('user_id, last_read_message_id')
            .eq('chat_id', oldChatId);

          if (readsToMove) {
            for (const read of readsToMove) {
              await supabase
                .from('chat_message_reads')
                .upsert({
                  chat_id: sharedChatId,
                  user_id: read.user_id,
                  last_read_message_id: read.last_read_message_id,
                  last_read_at: new Date().toISOString()
                }, { onConflict: 'chat_id,user_id' });
            }
          }

          // Eliminar chat_participants del chat viejo
          await supabase
            .from('chat_participants')
            .delete()
            .eq('chat_id', oldChatId);

          // Eliminar el chat viejo
          await supabase
            .from('chats')
            .delete()
            .eq('id', oldChatId);

          console.log(`   ✅ Chat ${oldChatId} consolidado`);
        }

        // Actualizar o crear space_chat para usar el chat compartido
        if (existingSpaceChat) {
          await supabase
            .from('space_chats')
            .update({ chat_id: sharedChatId })
            .eq('space_id', space.id);
        } else {
          await supabase
            .from('space_chats')
            .insert({ space_id: space.id, chat_id: sharedChatId });
        }

        console.log(`   ✅ Space ${space.id} ahora usa el chat compartido ${sharedChatId}`);
        fixed++;
      }
    }

    console.log('\n📊 Resumen:');
    console.log(`   ✅ Espacios consolidados: ${fixed}`);
    console.log(`   ❌ Errores: ${errors}`);

  } catch (error) {
    console.error('❌ Error general:', error);
    process.exit(1);
  }
}

// Ejecutar el script
fixUserChats()
  .then(() => {
    console.log('\n✅ Script completado.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  });

