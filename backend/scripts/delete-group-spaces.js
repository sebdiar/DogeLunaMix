import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function deleteGroupSpaces() {
  try {
    console.log('🔍 Buscando espacios de grupo...\n');

    // Get all user spaces
    const { data: userSpaces, error: userSpacesError } = await supabase
      .from('spaces')
      .select('id, name, user_id, category')
      .eq('category', 'user');

    if (userSpacesError) {
      console.error('❌ Error fetching user spaces:', userSpacesError);
      process.exit(1);
    }

    if (!userSpaces || userSpaces.length === 0) {
      console.log('✅ No se encontraron espacios de usuario.');
      process.exit(0);
    }

    console.log(`📊 Encontrados ${userSpaces.length} espacios de usuario.\n`);

    // Check each space to see if it's a group (has more than 2 participants)
    const groupSpaces = [];
    
    for (const space of userSpaces) {
      // Get chat for this space
      const { data: spaceChat } = await supabase
        .from('space_chats')
        .select('chat_id')
        .eq('space_id', space.id)
        .maybeSingle();

      if (spaceChat) {
        // Get participants count
        const { count: participantCount } = await supabase
          .from('chat_participants')
          .select('id', { count: 'exact' })
          .eq('chat_id', spaceChat.chat_id);

        if (participantCount && participantCount > 2) {
          groupSpaces.push({
            space,
            chatId: spaceChat.chat_id,
            participantCount
          });
        }
      }
    }

    if (groupSpaces.length === 0) {
      console.log('✅ No se encontraron espacios de grupo (más de 2 participantes).');
      process.exit(0);
    }

    console.log(`📊 Encontrados ${groupSpaces.length} espacios de grupo:\n`);
    groupSpaces.forEach(({ space, participantCount }) => {
      console.log(`   - "${space.name}" (${participantCount} participantes)`);
    });
    console.log('');

    // Delete group spaces
    console.log('🗑️  Eliminando espacios de grupo...\n');

    for (const { space, chatId } of groupSpaces) {
      // Delete space_chats
      await supabase
        .from('space_chats')
        .delete()
        .eq('space_id', space.id);

      // Delete chat_participants
      await supabase
        .from('chat_participants')
        .delete()
        .eq('chat_id', chatId);

      // Delete chat_messages
      await supabase
        .from('chat_messages')
        .delete()
        .eq('chat_id', chatId);

      // Delete chat_message_reads
      await supabase
        .from('chat_message_reads')
        .delete()
        .eq('chat_id', chatId);

      // Delete chats
      await supabase
        .from('chats')
        .delete()
        .eq('id', chatId);

      // Delete tabs
      await supabase
        .from('tabs')
        .delete()
        .eq('space_id', space.id);

      // Delete space
      await supabase
        .from('spaces')
        .delete()
        .eq('id', space.id);

      console.log(`✅ Eliminado grupo: "${space.name}"`);
    }

    console.log(`\n✨ Proceso completado! Se eliminaron ${groupSpaces.length} grupos.`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  }
}

deleteGroupSpaces();
