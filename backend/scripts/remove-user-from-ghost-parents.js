import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Script para remover al usuario 1 de los chats de ghost parents
 * donde se agregó incorrectamente
 */
async function removeUserFromGhostParents() {
  try {
    const userIdToRemove = 'a47b5aac-5b37-4a61-9650-ee3180ec96de'; // usuario 1
    
    console.log('🔧 Removiendo usuario 1 de chats de ghost parents...\n');
    
    // 1. Obtener todos los chats donde el usuario 1 es participante
    const { data: userChats, error: userChatsError } = await supabase
      .from('chat_participants')
      .select('chat_id')
      .eq('user_id', userIdToRemove);
    
    if (userChatsError) {
      console.error('❌ Error obteniendo chats del usuario:', userChatsError);
      return;
    }
    
    if (!userChats || userChats.length === 0) {
      console.log('✅ El usuario no es participante de ningún chat');
      return;
    }
    
    const chatIds = userChats.map(c => c.chat_id);
    console.log(`📋 Usuario 1 es participante de ${chatIds.length} chats\n`);
    
    // 2. Obtener los espacios vinculados a estos chats
    const { data: spaceChats, error: spaceChatsError } = await supabase
      .from('space_chats')
      .select('space_id, chat_id')
      .in('chat_id', chatIds);
    
    if (spaceChatsError) {
      console.error('❌ Error obteniendo space_chats:', spaceChatsError);
      return;
    }
    
    if (!spaceChats || spaceChats.length === 0) {
      console.log('✅ No hay espacios vinculados a estos chats');
      return;
    }
    
    const spaceIds = spaceChats.map(sc => sc.space_id);
    
    // 3. Obtener información de estos espacios
    const { data: spaces, error: spacesError } = await supabase
      .from('spaces')
      .select('id, name, category, user_id, parent_id')
      .in('id', spaceIds);
    
    if (spacesError) {
      console.error('❌ Error obteniendo espacios:', spacesError);
      return;
    }
    
    // 4. Para cada espacio, verificar si el usuario 1 tiene acceso a un child pero no al parent
    const ghostParentsToRemove = [];
    
    for (const space of spaces) {
      // Si el usuario 1 es el dueño del espacio, no es un ghost parent
      if (space.user_id === userIdToRemove) {
        continue;
      }
      
      // Verificar si el usuario tiene acceso a algún child de este espacio
      const { data: userChatsForCheck } = await supabase
        .from('chat_participants')
        .select('chat_id')
        .eq('user_id', userIdToRemove);
      
      if (userChatsForCheck && userChatsForCheck.length > 0) {
        const userChatIds = userChatsForCheck.map(c => c.chat_id);
        const { data: userSpaceChats } = await supabase
          .from('space_chats')
          .select('space_id')
          .in('chat_id', userChatIds);
        
        if (userSpaceChats) {
          const accessibleSpaceIds = userSpaceChats.map(sc => sc.space_id);
          const { data: childSpaces } = await supabase
            .from('spaces')
            .select('id, name')
            .eq('parent_id', space.id)
            .in('id', accessibleSpaceIds)
            .limit(1);
          
          // Si el usuario tiene acceso a un child pero está en el chat del parent,
          // este es un ghost parent - remover al usuario
          if (childSpaces && childSpaces.length > 0) {
            const spaceChat = spaceChats.find(sc => sc.space_id === space.id);
            if (spaceChat) {
              ghostParentsToRemove.push({
                space: space,
                chatId: spaceChat.chat_id,
                childSpace: childSpaces[0]
              });
            }
          }
        }
      }
    }
    
    if (ghostParentsToRemove.length === 0) {
      console.log('✅ No se encontraron ghost parents donde remover al usuario\n');
      return;
    }
    
    console.log(`🔍 Encontrados ${ghostParentsToRemove.length} ghost parents donde remover al usuario:\n`);
    
    // 5. Remover al usuario de estos chats
    for (const { space, chatId, childSpace } of ghostParentsToRemove) {
      console.log(`   - ${space.name} (id: ${space.id})`);
      console.log(`     Child: ${childSpace.name} (id: ${childSpace.id})`);
      console.log(`     Chat ID: ${chatId}`);
      
      const { error: deleteError } = await supabase
        .from('chat_participants')
        .delete()
        .eq('chat_id', chatId)
        .eq('user_id', userIdToRemove);
      
      if (deleteError) {
        console.error(`     ❌ Error removiendo: ${deleteError.message}`);
      } else {
        console.log(`     ✅ Usuario removido del chat`);
      }
      console.log('');
    }
    
    console.log('✨ Proceso completado!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  }
}

removeUserFromGhostParents();

