/**
 * Script para verificar el estado actual de Raneem
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function verifyRaneem() {
  const raneemUserId = '423f3dd9-a4f0-4a93-bd9a-3044d343a4e0';
  
  console.log('🔍 Verificando estado de Raneem...\n');
  
  // 1. Proyectos de Raneem
  const { data: raneemProjects } = await supabase
    .from('spaces')
    .select('id, name, user_id')
    .eq('category', 'project')
    .eq('user_id', raneemUserId);
  
  console.log(`1. Proyectos de Raneem: ${raneemProjects?.length || 0}`);
  if (raneemProjects && raneemProjects.length > 0) {
    raneemProjects.forEach(p => console.log(`   - ${p.name} (${p.id})`));
  }
  
  // 2. Proyectos donde Raneem es participante
  const { data: allProjectChats } = await supabase
    .from('space_chats')
    .select('chat_id, space_id, spaces!inner(id, name, user_id, category)')
    .eq('spaces.category', 'project');
  
  let participantCount = 0;
  if (allProjectChats) {
    for (const spaceChat of allProjectChats) {
      const { data: participant } = await supabase
        .from('chat_participants')
        .select('id')
        .eq('chat_id', spaceChat.chat_id)
        .eq('user_id', raneemUserId)
        .maybeSingle();
      
      if (participant) {
        participantCount++;
        console.log(`\n2. Raneem es participante de: ${spaceChat.spaces.name} (${spaceChat.spaces.id})`);
        console.log(`   Owner: ${spaceChat.spaces.user_id}`);
      }
    }
  }
  
  if (participantCount === 0) {
    console.log(`\n2. Raneem NO es participante de ningún proyecto ✅`);
  }
  
  // 3. Proyectos "Compartido"
  const { data: compartido } = await supabase
    .from('spaces')
    .select('id, name, user_id')
    .eq('category', 'project')
    .ilike('name', '%compartido%');
  
  console.log(`\n3. Proyectos "Compartido": ${compartido?.length || 0}`);
  if (compartido) {
    compartido.forEach(p => {
      console.log(`   - ${p.id} (owner: ${p.user_id})`);
    });
  }
}

verifyRaneem()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });





