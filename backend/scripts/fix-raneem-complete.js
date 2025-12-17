/**
 * Script COMPLETO para arreglar Raneem:
 * 1. Remover a Raneem de TODOS los chats de proyectos (sin excepciones)
 * 2. Eliminar TODOS los proyectos "Compartido" excepto el de Sebastian
 * 3. Eliminar TODOS los proyectos de Raneem
 * 4. Verificar que Raneem NO tenga acceso a ningún proyecto
 * 
 * Usage: node scripts/fix-raneem-complete.js
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function fixRaneemComplete() {
  console.log('🔧 FIX COMPLETO para Raneem...\n');
  
  const raneemUserId = '423f3dd9-a4f0-4a93-bd9a-3044d343a4e0';
  const sebastianUserId = 'dbc08b48-54d8-4aea-8444-f750ee515b02';
  
  // 1. Obtener TODOS los chats de proyectos
  console.log('1. Obteniendo todos los chats de proyectos...');
  
  const { data: allProjectSpaces } = await supabase
    .from('spaces')
    .select('id, user_id, name, category')
    .eq('category', 'project');
  
  if (!allProjectSpaces) {
    console.log('   ❌ No se pudieron obtener los proyectos');
    return;
  }
  
  console.log(`   Encontrados ${allProjectSpaces.length} proyectos`);
  
  // 2. Remover a Raneem de TODOS los chats de proyectos
  console.log('\n2. Removiendo a Raneem de TODOS los chats de proyectos...');
  
  let removedFromChats = 0;
  for (const space of allProjectSpaces) {
    // Obtener el chat de este espacio
    const { data: spaceChat } = await supabase
      .from('space_chats')
      .select('chat_id')
      .eq('space_id', space.id)
      .maybeSingle();
    
    if (spaceChat) {
      // Remover a Raneem de este chat (sin importar si es dueña o no)
      const { error } = await supabase
        .from('chat_participants')
        .delete()
        .eq('chat_id', spaceChat.chat_id)
        .eq('user_id', raneemUserId);
      
      if (!error) {
        removedFromChats++;
        console.log(`   ✅ Removida de: ${space.name} (${space.id})`);
      }
    }
  }
  
  console.log(`\n   Total: Removida de ${removedFromChats} chats`);
  
  // 3. Eliminar TODOS los proyectos "Compartido" excepto el de Sebastian
  console.log('\n3. Limpiando proyectos "Compartido"...');
  
  const { data: compartidoProjects } = await supabase
    .from('spaces')
    .select('id, user_id, name, created_at')
    .eq('category', 'project')
    .ilike('name', '%compartido%');
  
  if (compartidoProjects && compartidoProjects.length > 0) {
    console.log(`   Encontrados ${compartidoProjects.length} proyectos "Compartido":`);
    
    // Encontrar el de Sebastian (el más antiguo si hay varios)
    const sebastianCompartido = compartidoProjects
      .filter(p => p.user_id === sebastianUserId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
    
    if (sebastianCompartido) {
      console.log(`   ✅ Manteniendo: ${sebastianCompartido.id} (Sebastian)`);
      
      // Eliminar TODOS los demás (incluyendo otros de Sebastian si hay)
      const toDelete = compartidoProjects.filter(p => p.id !== sebastianCompartido.id);
      for (const project of toDelete) {
        const { error } = await supabase
          .from('spaces')
          .delete()
          .eq('id', project.id);
        
        if (!error) {
          console.log(`   ✅ Eliminado: ${project.id} (${project.user_id === sebastianUserId ? 'Sebastian' : 'Raneem'})`);
        }
      }
    } else {
      // No hay de Sebastian, eliminar TODOS
      console.log('   ⚠️  No se encontró proyecto "Compartido" de Sebastian, eliminando todos...');
      for (const project of compartidoProjects) {
        const { error } = await supabase
          .from('spaces')
          .delete()
          .eq('id', project.id);
        
        if (!error) {
          console.log(`   ✅ Eliminado: ${project.id}`);
        }
      }
    }
  } else {
    console.log('   ✅ No hay proyectos "Compartido"');
  }
  
  // 4. Eliminar TODOS los proyectos de Raneem
  console.log('\n4. Eliminando TODOS los proyectos de Raneem...');
  
  const { data: raneemProjects } = await supabase
    .from('spaces')
    .select('id, name')
    .eq('category', 'project')
    .eq('user_id', raneemUserId);
  
  if (raneemProjects && raneemProjects.length > 0) {
    console.log(`   Encontrados ${raneemProjects.length} proyectos de Raneem`);
    
    for (const project of raneemProjects) {
      const { error } = await supabase
        .from('spaces')
        .delete()
        .eq('id', project.id);
      
      if (!error) {
        console.log(`   ✅ Eliminado: ${project.name}`);
      }
    }
  } else {
    console.log('   ✅ No hay proyectos de Raneem');
  }
  
  // 5. Verificación final
  console.log('\n5. Verificación final...');
  
  // Verificar que Raneem no sea participante de ningún chat de proyecto
  const { data: allProjectChats } = await supabase
    .from('space_chats')
    .select('chat_id, spaces!inner(category)')
    .eq('spaces.category', 'project');
  
  if (allProjectChats) {
    let stillParticipant = 0;
    for (const spaceChat of allProjectChats) {
      const { data: participant } = await supabase
        .from('chat_participants')
        .select('id')
        .eq('chat_id', spaceChat.chat_id)
        .eq('user_id', raneemUserId)
        .maybeSingle();
      
      if (participant) {
        stillParticipant++;
        // Forzar eliminación
        await supabase
          .from('chat_participants')
          .delete()
          .eq('chat_id', spaceChat.chat_id)
          .eq('user_id', raneemUserId);
      }
    }
    
    if (stillParticipant > 0) {
      console.log(`   ⚠️  Se encontraron ${stillParticipant} participaciones restantes, eliminadas`);
    } else {
      console.log('   ✅ Raneem NO es participante de ningún chat de proyecto');
    }
  }
  
  // Verificar proyectos "Compartido"
  const { data: finalCompartido } = await supabase
    .from('spaces')
    .select('id, user_id, name')
    .eq('category', 'project')
    .ilike('name', '%compartido%');
  
  if (finalCompartido && finalCompartido.length > 0) {
    console.log(`\n   Proyectos "Compartido" restantes: ${finalCompartido.length}`);
    finalCompartido.forEach(p => {
      console.log(`     - ${p.id} (${p.user_id === sebastianUserId ? 'Sebastian' : 'Raneem'})`);
    });
  } else {
    console.log('\n   ✅ No hay proyectos "Compartido"');
  }
  
  // Verificar proyectos de Raneem
  const { data: finalRaneemProjects } = await supabase
    .from('spaces')
    .select('id, name')
    .eq('category', 'project')
    .eq('user_id', raneemUserId);
  
  if (finalRaneemProjects && finalRaneemProjects.length > 0) {
    console.log(`\n   ⚠️  Proyectos de Raneem restantes: ${finalRaneemProjects.length}`);
    finalRaneemProjects.forEach(p => {
      console.log(`     - ${p.name} (${p.id})`);
    });
  } else {
    console.log('\n   ✅ Raneem NO tiene proyectos');
  }
  
  console.log('\n✅ FIX COMPLETO terminado!');
}

// Run fix
fixRaneemComplete()
  .then(() => {
    console.log('\n✨ Todo listo!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });




