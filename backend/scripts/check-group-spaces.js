import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkGroupSpaces() {
  try {
    console.log('🔍 Verificando espacios de grupo...\n');

    // Get all user spaces
    const { data: userSpaces, error: userSpacesError } = await supabase
      .from('spaces')
      .select('id, name, user_id, category, created_at')
      .eq('category', 'user')
      .order('created_at', { ascending: false });

    if (userSpacesError) {
      console.error('❌ Error obteniendo espacios de usuario:', userSpacesError);
      process.exit(1);
    }

    if (!userSpaces || userSpaces.length === 0) {
      console.log('ℹ️  No se encontraron espacios de usuario.');
      process.exit(0);
    }

    console.log(`📊 Total de espacios de usuario: ${userSpaces.length}\n`);

    for (const space of userSpaces) {
      // Get chat for this space
      const { data: spaceChat } = await supabase
        .from('space_chats')
        .select('chat_id')
        .eq('space_id', space.id)
        .maybeSingle();

      if (spaceChat) {
        // Get participants
        const { data: participants } = await supabase
          .from('chat_participants')
          .select('user_id, users!chat_participants_user_id_fkey(id, name, email)')
          .eq('chat_id', spaceChat.chat_id);

        const participantCount = participants?.length || 0;
        const participantNames = participants?.map(p => p.users?.name || p.users?.email || 'Unknown').join(', ') || 'None';

        console.log(`📦 Espacio: "${space.name}"`);
        console.log(`   - ID: ${space.id}`);
        console.log(`   - Owner: ${space.user_id}`);
        console.log(`   - Participantes: ${participantCount}`);
        console.log(`   - Nombres: ${participantNames}`);
        console.log(`   - Chat ID: ${spaceChat.chat_id}`);
        
        if (participantCount > 2) {
          console.log(`   ✅ ES UN GRUPO (${participantCount} participantes)`);
        } else {
          console.log(`   💬 Es un DM (${participantCount} participantes)`);
        }
        console.log('');
      } else {
        console.log(`📦 Espacio: "${space.name}" (sin chat)`);
        console.log(`   - ID: ${space.id}`);
        console.log('');
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  }
}

checkGroupSpaces();

