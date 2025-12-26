import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Script para verificar si el usuario 1 está en chats de Amazon y Diaz
 */
async function checkGhostParentChats() {
  try {
    const userId = 'a47b5aac-5b37-4a61-9650-ee3180ec96de'; // usuario 1
    
    console.log('🔍 Verificando si usuario 1 está en chats de Amazon y Diaz...\n');
    
    // Buscar espacios Amazon y Diaz
    const { data: amazonSpace } = await supabase
      .from('spaces')
      .select('id, name, category, user_id')
      .eq('name', 'Amazon')
      .eq('category', 'project')
      .single();
    
    const { data: diazSpace } = await supabase
      .from('spaces')
      .select('id, name, category, user_id')
      .eq('name', 'DIAZ')
      .eq('category', 'project')
      .single();
    
    const spacesToCheck = [];
    if (amazonSpace) spacesToCheck.push(amazonSpace);
    if (diazSpace) spacesToCheck.push(diazSpace);
    
    if (spacesToCheck.length === 0) {
      console.log('⚠️  No se encontraron espacios Amazon o DIAZ');
      return;
    }
    
    for (const space of spacesToCheck) {
      console.log(`\n📁 Verificando: ${space.name} (ID: ${space.id})`);
      
      // Obtener el chat de este espacio
      const { data: spaceChat } = await supabase
        .from('space_chats')
        .select('chat_id')
        .eq('space_id', space.id)
        .maybeSingle();
      
      if (!spaceChat) {
        console.log('   ℹ️  Este espacio no tiene chat');
        continue;
      }
      
      console.log(`   Chat ID: ${spaceChat.chat_id}`);
      
      // Verificar si el usuario 1 es participante de este chat
      const { data: participant } = await supabase
        .from('chat_participants')
        .select('id')
        .eq('chat_id', spaceChat.chat_id)
        .eq('user_id', userId)
        .maybeSingle();
      
      if (participant) {
        console.log(`   ⚠️  PROBLEMA: Usuario 1 está en el chat de ${space.name}`);
        console.log(`   🔧 Removiendo usuario 1 del chat...`);
        
        const { error: deleteError } = await supabase
          .from('chat_participants')
          .delete()
          .eq('chat_id', spaceChat.chat_id)
          .eq('user_id', userId);
        
        if (deleteError) {
          console.error(`   ❌ Error removiendo: ${deleteError.message}`);
        } else {
          console.log(`   ✅ Usuario 1 removido del chat de ${space.name}`);
        }
      } else {
        console.log(`   ✅ Usuario 1 NO está en el chat de ${space.name}`);
      }
    }
    
    console.log('\n✨ Verificación completada!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  }
}

checkGhostParentChats();

