// Script para inspeccionar espacios y chats
import supabase from './config/database.js';

async function inspectSpaces() {
  console.log('🔍 Inspeccionando espacios de tipo "user"...\n');
  
  const { data: spaces } = await supabase
    .from('spaces')
    .select('*')
    .eq('category', 'user')
    .eq('archived', false);
  
  if (!spaces) {
    console.log('No hay espacios');
    return;
  }
  
  for (const space of spaces) {
    console.log(`\n📦 Espacio: ${space.id}`);
    console.log(`   Nombre: ${space.name}`);
    console.log(`   Owner ID: ${space.user_id}`);
    
    // Get owner
    const { data: owner } = await supabase
      .from('users')
      .select('id, email, name')
      .eq('id', space.user_id)
      .single();
    console.log(`   Owner: ${owner?.name || owner?.email || 'NOT FOUND'}`);
    
    // Get chat
    const { data: spaceChat } = await supabase
      .from('space_chats')
      .select('chat_id')
      .eq('space_id', space.id)
      .single();
    
    if (spaceChat) {
      console.log(`   Chat ID: ${spaceChat.chat_id}`);
      
      // Get participants
      const { data: participants } = await supabase
        .from('chat_participants')
        .select('user_id, users!chat_participants_user_id_fkey(id, email, name)')
        .eq('chat_id', spaceChat.chat_id);
      
      console.log(`   Participantes:`);
      if (participants) {
        for (const p of participants) {
          const user = p.users;
          console.log(`     - ${user?.name || user?.email || p.user_id}`);
        }
      }
      
      // Get message count
      const { data: messages } = await supabase
        .from('chat_messages')
        .select('id')
        .eq('chat_id', spaceChat.chat_id);
      console.log(`   Mensajes: ${messages?.length || 0}`);
    } else {
      console.log(`   ⚠️  No tiene chat asociado`);
    }
    
    // Get tabs
    const { data: tabs } = await supabase
      .from('tabs')
      .select('id, title, url')
      .eq('space_id', space.id);
    console.log(`   Tabs: ${tabs?.length || 0}`);
    if (tabs) {
      for (const tab of tabs) {
        console.log(`     - ${tab.title} (${tab.url})`);
      }
    }
  }
}

inspectSpaces().catch(console.error);










