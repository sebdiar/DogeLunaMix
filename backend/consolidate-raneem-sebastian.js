// Script para consolidar los espacios entre Raneem y Sebastian
import supabase from './config/database.js';

async function consolidate() {
  console.log('🔧 Consolidando espacios entre Raneem y Sebastian...\n');
  
  // Get users
  const { data: sebastian } = await supabase
    .from('users')
    .select('id, email, name')
    .or('email.ilike.%sebastian%,name.ilike.%sebastian%')
    .limit(1)
    .single();
  
  const { data: raneem } = await supabase
    .from('users')
    .select('id, email, name')
    .or('email.ilike.%raneem%,name.ilike.%raneem%')
    .limit(1)
    .single();
  
  if (!sebastian || !raneem) {
    console.error('❌ No se encontraron los usuarios');
    return;
  }
  
  console.log(`Sebastian: ${sebastian.name || sebastian.email} (${sebastian.id})`);
  console.log(`Raneem: ${raneem.name || raneem.email} (${raneem.id})\n`);
  
  // Get all spaces between these users
  const { data: allSpaces } = await supabase
    .from('spaces')
    .select('*')
    .eq('category', 'user')
    .eq('archived', false)
    .or(`user_id.eq.${sebastian.id},user_id.eq.${raneem.id}`);
  
  if (!allSpaces || allSpaces.length === 0) {
    console.log('No hay espacios');
    return;
  }
  
  console.log(`📦 Encontrados ${allSpaces.length} espacios\n`);
  
  // Find the space with the most messages
  let bestSpace = null;
  let bestChatId = null;
  let maxMessages = 0;
  
  for (const space of allSpaces) {
    const { data: spaceChat } = await supabase
      .from('space_chats')
      .select('chat_id')
      .eq('space_id', space.id)
      .single();
    
    if (spaceChat) {
      const { data: messages } = await supabase
        .from('chat_messages')
        .select('id')
        .eq('chat_id', spaceChat.chat_id);
      
      const msgCount = messages?.length || 0;
      console.log(`   Espacio ${space.id}: ${msgCount} mensajes`);
      
      if (msgCount > maxMessages) {
        maxMessages = msgCount;
        bestSpace = space;
        bestChatId = spaceChat.chat_id;
      }
    } else if (!bestSpace) {
      bestSpace = space;
    }
  }
  
  if (!bestSpace) {
    console.log('No se encontró un espacio válido');
    return;
  }
  
  console.log(`\n✅ Espacio principal: ${bestSpace.id} (${maxMessages} mensajes)`);
  console.log(`   Chat ID: ${bestChatId}\n`);
  
  // Ensure both users are participants in the best chat
  if (bestChatId) {
    for (const userId of [sebastian.id, raneem.id]) {
      const { data: existing } = await supabase
        .from('chat_participants')
        .select('id')
        .eq('chat_id', bestChatId)
        .eq('user_id', userId)
        .single();
      
      if (!existing) {
        await supabase
          .from('chat_participants')
          .insert({ chat_id: bestChatId, user_id: userId });
        console.log(`✅ Agregado como participante: ${userId === sebastian.id ? 'Sebastian' : 'Raneem'}`);
      } else {
        console.log(`✓ Ya es participante: ${userId === sebastian.id ? 'Sebastian' : 'Raneem'}`);
      }
    }
  }
  
  // Merge other spaces into the best one
  for (const space of allSpaces) {
    if (space.id === bestSpace.id) continue;
    
    console.log(`\n🔄 Procesando espacio duplicado: ${space.id}`);
    
    // Get chat for this space
    const { data: spaceChat } = await supabase
      .from('space_chats')
      .select('chat_id')
      .eq('space_id', space.id)
      .single();
    
    if (spaceChat && spaceChat.chat_id !== bestChatId) {
      // Merge participants
      const { data: participants } = await supabase
        .from('chat_participants')
        .select('user_id')
        .eq('chat_id', spaceChat.chat_id);
      
      if (participants) {
        for (const p of participants) {
          const { data: existing } = await supabase
            .from('chat_participants')
            .select('id')
            .eq('chat_id', bestChatId)
            .eq('user_id', p.user_id)
            .single();
          
          if (!existing) {
            await supabase
              .from('chat_participants')
              .insert({ chat_id: bestChatId, user_id: p.user_id });
          }
        }
      }
      
      // Move messages
      await supabase
        .from('chat_messages')
        .update({ chat_id: bestChatId })
        .eq('chat_id', spaceChat.chat_id);
      
      // Update space_chats to point to best chat
      await supabase
        .from('space_chats')
        .update({ chat_id: bestChatId })
        .eq('space_id', space.id);
      
      // Delete duplicate chat
      await supabase
        .from('chats')
        .delete()
        .eq('id', spaceChat.chat_id);
      
      console.log(`   ✅ Chat ${spaceChat.chat_id} fusionado`);
    } else if (!spaceChat && bestChatId) {
      // Link space to best chat
      await supabase
        .from('space_chats')
        .insert({ space_id: space.id, chat_id: bestChatId });
      console.log(`   ✅ Espacio vinculado al chat principal`);
    }
    
    // Delete duplicate chat tabs
    const { data: chatTabs } = await supabase
      .from('tabs')
      .select('id')
      .eq('space_id', space.id)
      .ilike('url', '%chat%');
    
    if (chatTabs && chatTabs.length > 0) {
      for (const tab of chatTabs) {
        await supabase
          .from('tabs')
          .delete()
          .eq('id', tab.id);
      }
      console.log(`   🗑️  ${chatTabs.length} tabs de chat eliminados`);
    }
    
    // Move other tabs to best space
    const { data: otherTabs } = await supabase
      .from('tabs')
      .select('id, url')
      .eq('space_id', space.id);
    
    if (otherTabs && otherTabs.length > 0) {
      for (const tab of otherTabs) {
        const { data: existing } = await supabase
          .from('tabs')
          .select('id')
          .eq('space_id', bestSpace.id)
          .eq('url', tab.url)
          .single();
        
        if (!existing) {
          await supabase
            .from('tabs')
            .update({ space_id: bestSpace.id })
            .eq('id', tab.id);
        } else {
          await supabase
            .from('tabs')
            .delete()
            .eq('id', tab.id);
        }
      }
      console.log(`   📑 ${otherTabs.length} tabs procesados`);
    }
    
    // Delete duplicate space
    await supabase
      .from('spaces')
      .delete()
      .eq('id', space.id);
    
    console.log(`   🗑️  Espacio ${space.id} eliminado`);
  }
  
  // Ensure best space has a chat tab
  const { data: existingChatTab } = await supabase
    .from('tabs')
    .select('id')
    .eq('space_id', bestSpace.id)
    .ilike('url', '%chat%')
    .single();
  
  if (!existingChatTab) {
    await supabase
      .from('tabs')
      .insert({
        space_id: bestSpace.id,
        title: 'Chat',
        url: `luna://chat/${bestSpace.id}`,
        user_id: bestSpace.user_id,
        type: 'chat'
      });
    console.log(`\n📝 Tab de chat creado para espacio principal`);
  }
  
  // Update space name to be consistent (use Raneem's name since space is owned by Sebastian)
  await supabase
    .from('spaces')
    .update({ name: raneem.name || raneem.email })
    .eq('id', bestSpace.id);
  
  // Verify final state
  console.log(`\n📊 Estado final:`);
  const { data: finalSpace } = await supabase
    .from('spaces')
    .select('*')
    .eq('id', bestSpace.id)
    .single();
  
  const { data: finalChat } = await supabase
    .from('space_chats')
    .select('chat_id')
    .eq('space_id', bestSpace.id)
    .single();
  
  if (finalChat) {
    const { data: finalParticipants } = await supabase
      .from('chat_participants')
      .select('user_id, users!chat_participants_user_id_fkey(id, name, email)')
      .eq('chat_id', finalChat.chat_id);
    
    const { data: finalMessages } = await supabase
      .from('chat_messages')
      .select('id')
      .eq('chat_id', finalChat.chat_id);
    
    console.log(`   Espacio: ${finalSpace.id}`);
    console.log(`   Chat: ${finalChat.chat_id}`);
    console.log(`   Participantes: ${finalParticipants?.length || 0}`);
    if (finalParticipants) {
      for (const p of finalParticipants) {
        console.log(`     - ${p.users?.name || p.users?.email || p.user_id}`);
      }
    }
    console.log(`   Mensajes: ${finalMessages?.length || 0}`);
  }
  
  console.log(`\n✨ Consolidación completada!`);
}

consolidate().catch(console.error);














