/**
 * Script de EMERGENCIA para revertir los cambios de fix-dias-parent.js
 * Restaura la estructura original de parent_id
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function revertDiasParent() {
  console.log('🚨 REVIRTIENDO cambios de fix-dias-parent.js...\n');
  
  const diasId = '5cfdecea-29d5-4092-a925-fab2be5306d4'; // DIAZ
  
  // 1. Restaurar parent_id de DIAZ a Amazon (f68b7b4c-5f73-48f3-9fd6-53812ddf76cf)
  console.log('🔧 Restaurando parent_id de DIAZ a Amazon...');
  const { error: updateDiasError } = await supabase
    .from('spaces')
    .update({ parent_id: 'f68b7b4c-5f73-48f3-9fd6-53812ddf76cf' })
    .eq('id', diasId);
  
  if (updateDiasError) {
    console.error('❌ Error restaurando DIAZ:', updateDiasError);
  } else {
    console.log('✅ DIAZ restaurado a tener Amazon como parent');
  }
  
  // 2. Obtener todos los proyectos que tienen DIAZ como parent
  const { data: projectsWithDias, error: fetchError } = await supabase
    .from('spaces')
    .select('id, name, user_id')
    .eq('category', 'project')
    .eq('parent_id', diasId);
  
  if (fetchError) {
    console.error('❌ Error obteniendo proyectos:', fetchError);
    process.exit(1);
  }
  
  if (!projectsWithDias || projectsWithDias.length === 0) {
    console.log('✅ No hay proyectos con DIAZ como parent para revertir');
    process.exit(0);
  }
  
  console.log(`\n📦 Encontrados ${projectsWithDias.length} proyectos con DIAZ como parent`);
  console.log('⚠️  NO puedo restaurar automáticamente los parent_id originales');
  console.log('   porque no tengo un backup de la estructura anterior.');
  console.log('\n💡 Opciones:');
  console.log('   1. Restaurar desde un backup de la base de datos');
  console.log('   2. Decirme qué proyectos deberían tener qué parent_id');
  console.log('   3. Si tienes los parent_id originales, puedo crear un script para restaurarlos');
  
  console.log('\n📋 Proyectos afectados:');
  projectsWithDias.forEach(p => {
    console.log(`   - ${p.name} (ID: ${p.id})`);
  });
  
  // Por ahora, solo removemos DIAZ como parent de todos (los dejamos sin parent temporalmente)
  console.log('\n🔧 Removiendo DIAZ como parent de todos los proyectos...');
  console.log('   (Los dejaré sin parent temporalmente hasta que me digas la estructura correcta)');
  
  let revertedCount = 0;
  for (const project of projectsWithDias) {
    const { error: updateError } = await supabase
      .from('spaces')
      .update({ parent_id: null })
      .eq('id', project.id);
    
    if (updateError) {
      console.error(`   ❌ Error removiendo parent de ${project.name}:`, updateError);
    } else {
      console.log(`   ✅ ${project.name} ahora sin parent (temporalmente)`);
      revertedCount++;
    }
  }
  
  console.log(`\n✅ ${revertedCount} proyectos revertidos (sin parent temporalmente)`);
  console.log('⚠️  IMPORTANTE: Necesito que me digas la estructura correcta de parent_id');
  console.log('   para restaurar completamente.');
}

revertDiasParent()
  .then(() => {
    console.log('\n🎉 Reversión parcial completada');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });

