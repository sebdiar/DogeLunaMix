import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Script para verificar los chats del usuario 1 y sus espacios vinculados
 */
async function checkUserChats() {
  try {
    const userId = 'a47b5aac-5b37-4a61-9650-ee3180ec96de'; // usuario 1
    
    console.log('🔍 Verificando chats del usuario 1...\n');
    
    // 1. Obtener todos los chats donde el usuario 1 es participante
    const { data: userChats, error: userChatsError } = await supabase
      .from('chat_participants')
      .select('chat_id')
      .eq('user_id', userId);
    
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
    
    console.log(`📁 Espacios vinculados a los chats del usuario 1:\n`);
    
    for (const space of spaces) {
      const isOwner = space.user_id === userId;
      const hasParent = space.parent_id ? 'Sí' : 'No';
      const ownerInfo = isOwner ? '(OWNER)' : `(Owner: ${space.user_id})`;
      
      console.log(`   - ${space.name} (${space.category})`);
      console.log(`     ID: ${space.id}`);
      console.log(`     Owner: ${ownerInfo}`);
      console.log(`     Parent ID: ${space.parent_id || 'Ninguno'}`);
      
      // Verificar si el usuario tiene acceso a algún child de este espacio
      if (!isOwner && !space.parent_id) {
        // Este podría ser un ghost parent - verificar si hay children accesibles
        const { data: userChatsForCheck } = await supabase
          .from('chat_participants')
          .select('chat_id')
          .eq('user_id', userId);
        
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
              .in('id', accessibleSpaceIds);
            
            if (childSpaces && childSpaces.length > 0) {
              console.log(`     ⚠️  GHOST PARENT: Usuario tiene acceso a children: ${childSpaces.map(c => c.name).join(', ')}`);
            }
          }
        }
      }
      
      console.log('');
    }
    
    console.log('✨ Verificación completada!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  }
}

checkUserChats();

