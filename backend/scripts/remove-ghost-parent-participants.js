import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Script para remover usuarios que fueron agregados incorrectamente a ghost parents
 * 
 * Un ghost parent es un espacio que:
 * 1. No es propiedad del usuario
 * 2. El usuario tiene acceso a un child space de ese parent
 * 3. El usuario NO tiene acceso directo al parent (no es participante del chat del parent)
 * 
 * Si un usuario es participante del chat de un ghost parent, debe ser removido.
 */
async function removeGhostParentParticipants() {
  try {
    console.log('🔧 Removiendo usuarios de ghost parents SOLO para usuario 1...\n');

    // SOLO procesar usuario 1 (email o name = "1")
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, name, email')
      .or('email.eq.1,name.eq.1');

    if (usersError || !users || users.length === 0) {
      console.error('❌ Error obteniendo usuario 1 o no existe:', usersError);
      return;
    }

    console.log(`📋 Procesando SOLO usuario 1\n`);

    for (const user of users) {
      console.log(`👤 Procesando usuario: ${user.name || user.email} (${user.id})`);

      // Obtener todos los chats donde el usuario es participante
      const { data: userChats, error: chatsError } = await supabase
        .from('chat_participants')
        .select('chat_id')
        .eq('user_id', user.id);

      if (chatsError || !userChats || userChats.length === 0) {
        console.log(`   ⏭️  No tiene chats, saltando...\n`);
        continue;
      }

      const chatIds = userChats.map(c => c.chat_id);

      // Obtener espacios vinculados a estos chats
      const { data: spaceChats, error: spaceChatsError } = await supabase
        .from('space_chats')
        .select('space_id, chat_id')
        .in('chat_id', chatIds);

      if (spaceChatsError || !spaceChats || spaceChats.length === 0) {
        console.log(`   ⏭️  No tiene espacios vinculados, saltando...\n`);
        continue;
      }

      const accessibleSpaceIds = spaceChats.map(sc => sc.space_id);

      // Obtener los espacios a los que el usuario tiene acceso
      const { data: accessibleSpaces, error: spacesError } = await supabase
        .from('spaces')
        .select('id, name, user_id, parent_id, category')
        .in('id', accessibleSpaceIds);

      if (spacesError || !accessibleSpaces) {
        console.log(`   ⚠️  Error obteniendo espacios:`, spacesError);
        continue;
      }

      // Identificar child spaces (espacios con parent_id)
      const childSpaces = accessibleSpaces.filter(s => s.parent_id);
      const parentIds = new Set(childSpaces.map(s => s.parent_id));

      if (parentIds.size === 0) {
        console.log(`   ✅ No tiene child spaces, no hay ghost parents\n`);
        continue;
      }

      console.log(`   📦 Tiene ${childSpaces.length} child spaces con ${parentIds.size} parents únicos`);

      // Para cada parent, verificar si el usuario tiene acceso directo
      let removedCount = 0;
      for (const parentId of parentIds) {
        // Obtener el parent space
        const { data: parentSpace, error: parentError } = await supabase
          .from('spaces')
          .select('id, name, user_id, category')
          .eq('id', parentId)
          .single();

        if (parentError || !parentSpace) {
          continue;
        }

        // Si el usuario es el dueño del parent, no es ghost parent
        if (parentSpace.user_id === user.id) {
          continue;
        }

        // Verificar si el usuario tiene acceso directo al parent (es participante del chat del parent)
        const { data: parentSpaceChat } = await supabase
          .from('space_chats')
          .select('chat_id')
          .eq('space_id', parentId)
          .maybeSingle();

        if (parentSpaceChat) {
          const { data: parentParticipant } = await supabase
            .from('chat_participants')
            .select('id')
            .eq('chat_id', parentSpaceChat.chat_id)
            .eq('user_id', user.id)
            .maybeSingle();

          // Si el usuario NO es participante del chat del parent, pero tiene acceso a un child,
          // entonces el parent es un ghost parent y el usuario NO debería ser participante
          if (!parentParticipant) {
            // El parent es un ghost parent - el usuario NO debería tener acceso
            // Pero si de alguna manera es participante, debemos verificar y removerlo
            // (aunque según la lógica, no debería ser participante si no tiene acceso directo)
            console.log(`   👻 Ghost parent detectado: ${parentSpace.name} (${parentId})`);
            console.log(`      ✅ Usuario NO es participante (correcto)`);
          } else {
            // El usuario ES participante del chat del parent
            // Si el usuario tiene acceso a un child pero NO es el dueño del parent,
            // y es participante del chat, esto es un ghost parent con acceso incorrecto
            // Debe ser removido del chat del parent
            
            console.log(`   ⚠️  Usuario es participante de ${parentSpace.name} pero solo tiene acceso a child`);
            console.log(`      🗑️  Removiendo usuario del chat del ghost parent...`);
            
            // Remover usuario del chat del ghost parent
            const { error: removeError } = await supabase
              .from('chat_participants')
              .delete()
              .eq('chat_id', parentSpaceChat.chat_id)
              .eq('user_id', user.id);
            
            if (removeError) {
              console.log(`      ❌ Error removiendo:`, removeError);
            } else {
              console.log(`      ✅ Usuario removido del chat del ghost parent`);
              removedCount++;
            }
          }
        }
      }

      if (removedCount > 0) {
        console.log(`   🗑️  Removido de ${removedCount} ghost parent(s)\n`);
      } else {
        console.log(`   ✅ No se encontraron ghost parents con acceso incorrecto\n`);
      }
    }

    console.log('✨ Proceso completado!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  }
}

removeGhostParentParticipants();

