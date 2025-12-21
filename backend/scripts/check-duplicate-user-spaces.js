/**
 * Script para verificar espacios de usuario duplicados y chats duplicados
 * 
 * Ejecutar con: node backend/scripts/check-duplicate-user-spaces.js
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkDuplicateUserSpaces() {
  console.log('🔍 Verificando espacios de usuario y chats duplicados...\n');

  try {
    // 1. Obtener todos los espacios de usuario
    const { data: userSpaces, error: spacesError } = await supabase
      .from('spaces')
      .select('id, user_id, name, category, created_at')
      .eq('category', 'user')
      .eq('archived', false)
      .order('created_at', { ascending: true });

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
      .select('id, name, email, avatar_photo');

    if (usersError) {
      console.error('❌ Error al obtener usuarios:', usersError);
      process.exit(1);
    }

    const userMap = new Map(users.map(u => [u.id, u]));

    // 3. Agrupar espacios por nombre (que debería ser el email/nombre del otro usuario)
    const spacesByName = new Map();
    userSpaces.forEach(space => {
      const key = space.name.toLowerCase().trim();
      if (!spacesByName.has(key)) {
        spacesByName.set(key, []);
      }
      spacesByName.get(key).push(space);
    });

    // 4. Encontrar duplicados
    const duplicates = [];
    spacesByName.forEach((spaces, name) => {
      if (spaces.length > 1) {
        duplicates.push({ name, spaces });
      }
    });

    if (duplicates.length > 0) {
      console.log(`⚠️  Encontrados ${duplicates.length} grupos de espacios duplicados:\n`);
      duplicates.forEach(({ name, spaces }) => {
        console.log(`   Nombre: "${name}"`);
        spaces.forEach(space => {
          const owner = userMap.get(space.user_id);
          console.log(`     - Space ID: ${space.id}, Owner: ${owner?.name || owner?.email || space.user_id}, Created: ${space.created_at}`);
        });
        console.log('');
      });
    } else {
      console.log('✅ No se encontraron espacios duplicados por nombre.\n');
    }

    // 5. Obtener todos los chats de estos espacios
    const spaceIds = userSpaces.map(s => s.id);
    const { data: spaceChats, error: spaceChatsError } = await supabase
      .from('space_chats')
      .select('space_id, chat_id')
      .in('space_id', spaceIds);

    if (spaceChatsError) {
      console.error('❌ Error al obtener space_chats:', spaceChatsError);
      process.exit(1);
    }

    console.log(`📊 Encontrados ${spaceChats.length} space_chats.\n`);

    // 6. Agrupar por chat_id para encontrar espacios que comparten chat
    const chatToSpaces = new Map();
    spaceChats.forEach(sc => {
      if (!chatToSpaces.has(sc.chat_id)) {
        chatToSpaces.set(sc.chat_id, []);
      }
      chatToSpaces.get(sc.chat_id).push(sc.space_id);
    });

    // 7. Para cada chat, verificar los participantes
    console.log('📊 Analizando chats y participantes:\n');
    const chatAnalysis = [];

    for (const [chatId, spaceIdsForChat] of chatToSpaces.entries()) {
      const spaces = userSpaces.filter(s => spaceIdsForChat.includes(s.id));
      
      // Obtener participantes del chat
      const { data: participants } = await supabase
        .from('chat_participants')
        .select('user_id')
        .eq('chat_id', chatId);

      const participantIds = participants?.map(p => p.user_id) || [];
      
      chatAnalysis.push({
        chatId,
        spaces,
        participantIds,
        participantCount: participantIds.length
      });

      console.log(`   Chat ${chatId}:`);
      console.log(`     - Espacios: ${spaces.length}`);
      spaces.forEach(space => {
        const owner = userMap.get(space.user_id);
        console.log(`       * Space ${space.id} (${space.name}) - Owner: ${owner?.name || owner?.email || space.user_id}`);
      });
      console.log(`     - Participantes: ${participantIds.length}`);
      participantIds.forEach(userId => {
        const user = userMap.get(userId);
        console.log(`       * ${user?.name || user?.email || userId}`);
      });
      console.log('');
    }

    // 8. Buscar chats duplicados entre los mismos usuarios
    console.log('🔍 Buscando chats duplicados entre los mismos usuarios...\n');
    const userPairs = new Map();

    chatAnalysis.forEach(({ chatId, participantIds }) => {
      if (participantIds.length === 2) {
        const sortedIds = [...participantIds].sort();
        const pairKey = `${sortedIds[0]}-${sortedIds[1]}`;
        
        if (!userPairs.has(pairKey)) {
          userPairs.set(pairKey, []);
        }
        userPairs.get(pairKey).push(chatId);
      }
    });

    const duplicateChats = [];
    userPairs.forEach((chatIds, pairKey) => {
      if (chatIds.length > 1) {
        const [userId1, userId2] = pairKey.split('-');
        const user1 = userMap.get(userId1);
        const user2 = userMap.get(userId2);
        duplicateChats.push({
          user1: user1?.name || user1?.email || userId1,
          user2: user2?.name || user2?.email || userId2,
          chatIds
        });
      }
    });

    if (duplicateChats.length > 0) {
      console.log(`⚠️  Encontrados ${duplicateChats.length} pares de usuarios con múltiples chats:\n`);
      duplicateChats.forEach(({ user1, user2, chatIds }) => {
        console.log(`   ${user1} <-> ${user2}:`);
        chatIds.forEach(chatId => {
          const analysis = chatAnalysis.find(a => a.chatId === chatId);
          console.log(`     - Chat ${chatId} (${analysis?.spaces.length || 0} espacios)`);
        });
        console.log('');
      });
    } else {
      console.log('✅ No se encontraron chats duplicados entre los mismos usuarios.\n');
    }

    // 9. Resumen
    console.log('\n📊 Resumen:');
    console.log(`   - Total espacios de usuario: ${userSpaces.length}`);
    console.log(`   - Total chats: ${chatToSpaces.size}`);
    console.log(`   - Espacios duplicados por nombre: ${duplicates.length}`);
    console.log(`   - Chats duplicados entre mismos usuarios: ${duplicateChats.length}`);

    if (duplicates.length > 0 || duplicateChats.length > 0) {
      console.log('\n⚠️  Se recomienda ejecutar el script de consolidación o borrado.');
    }

  } catch (error) {
    console.error('❌ Error general:', error);
    process.exit(1);
  }
}

// Ejecutar el script
checkDuplicateUserSpaces()
  .then(() => {
    console.log('\n✅ Script completado.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  });


