/**
 * Script para verificar los chats de usuario actuales
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkCurrentUserChats() {
  console.log('🔍 Verificando chats y espacios de usuario actuales...\n');

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

    console.log(`📊 Espacios de usuario encontrados: ${userSpaces?.length || 0}\n`);

    if (userSpaces && userSpaces.length > 0) {
      const spaceIds = userSpaces.map(s => s.id);
      
      // Obtener usuarios para mostrar nombres
      const { data: users } = await supabase
        .from('users')
        .select('id, name, email');
      
      const userMap = new Map(users?.map(u => [u.id, u]) || []);

      // 2. Obtener todos los space_chats de estos espacios
      const { data: spaceChats, error: spaceChatsError } = await supabase
        .from('space_chats')
        .select('space_id, chat_id')
        .in('space_id', spaceIds);

      if (spaceChatsError) {
        console.error('❌ Error al obtener space_chats:', spaceChatsError);
        process.exit(1);
      }

      console.log(`📊 space_chats encontrados: ${spaceChats?.length || 0}\n`);

      // 3. Agrupar por espacio
      const spaceToChats = new Map();
      spaceChats?.forEach(sc => {
        if (!spaceToChats.has(sc.space_id)) {
          spaceToChats.set(sc.space_id, []);
        }
        spaceToChats.get(sc.space_id).push(sc.chat_id);
      });

      // 4. Mostrar detalles
      console.log('📋 Detalles por espacio:\n');
      for (const space of userSpaces) {
        const owner = userMap.get(space.user_id);
        const chatIds = spaceToChats.get(space.id) || [];
        
        console.log(`   Espacio "${space.name}"`);
        console.log(`     - ID: ${space.id}`);
        console.log(`     - Owner: ${owner?.name || owner?.email || space.user_id}`);
        console.log(`     - Created: ${space.created_at}`);
        console.log(`     - Chats asociados: ${chatIds.length}`);
        
        if (chatIds.length > 1) {
          console.log(`     ⚠️  PROBLEMA: Este espacio tiene ${chatIds.length} chats (debería tener solo 1)`);
        }
        
        for (const chatId of chatIds) {
          // Obtener participantes del chat
          const { data: participants } = await supabase
            .from('chat_participants')
            .select('user_id')
            .eq('chat_id', chatId);
          
          const participantIds = participants?.map(p => p.user_id) || [];
          const participantNames = participantIds.map(id => {
            const u = userMap.get(id);
            return u?.name || u?.email || id;
          });
          
          console.log(`       * Chat ${chatId}`);
          console.log(`         Participantes: ${participantNames.join(', ')} (${participantIds.length})`);
        }
        console.log('');
      }

      // 5. Verificar duplicados
      const allChatIds = spaceChats?.map(sc => sc.chat_id) || [];
      const uniqueChatIds = [...new Set(allChatIds)];
      
      if (allChatIds.length !== uniqueChatIds.length) {
        console.log('⚠️  PROBLEMA: Hay chats duplicados (mismo chat asociado a múltiples espacios)\n');
      }

      // 6. Resumen
      console.log('📊 Resumen:');
      console.log(`   - Total espacios: ${userSpaces.length}`);
      console.log(`   - Total space_chats: ${spaceChats?.length || 0}`);
      console.log(`   - Total chats únicos: ${uniqueChatIds.length}`);
      console.log(`   - Espacios con múltiples chats: ${Array.from(spaceToChats.values()).filter(chats => chats.length > 1).length}`);

    } else {
      console.log('📊 No hay espacios de usuario.\n');
    }

  } catch (error) {
    console.error('❌ Error general:', error);
    process.exit(1);
  }
}

checkCurrentUserChats()
  .then(() => {
    console.log('\n✅ Script completado.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  });


