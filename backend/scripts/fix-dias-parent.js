/**
 * Script para corregir la jerarquía de proyectos
 * Asegura que "días" sea el parent raíz (sin parent_id)
 * y que todos los demás proyectos tengan "días" como parent
 * 
 * Usage: 
 *   node scripts/fix-dias-parent.js
 *   node scripts/fix-dias-parent.js <ID_DEL_PROYECTO_DIAS>
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function fixDiasParent() {
  console.log('🔍 Buscando proyecto "días" y corrigiendo jerarquía...\n');
  
  // Buscar el proyecto "días" (case insensitive, con varias variaciones)
  const searchTerms = ['días', 'dias', 'days', 'Days', 'Días'];
  let diasProjects = [];
  
  for (const term of searchTerms) {
    const { data: found, error: fetchError } = await supabase
      .from('spaces')
      .select('id, name, user_id, parent_id, notion_page_id, category')
      .eq('category', 'project')
      .ilike('name', `%${term}%`);
    
    if (fetchError) {
      console.error('❌ Error buscando proyectos:', fetchError);
      process.exit(1);
    }
    
    if (found && found.length > 0) {
      diasProjects = found;
      break;
    }
  }
  
  if (!diasProjects || diasProjects.length === 0) {
    console.log('⚠️  No se encontró ningún proyecto con "días" en el nombre.');
    console.log('\n📋 Listando todos los proyectos para que identifiques cuál es "días":\n');
    
    // Obtener todos los proyectos
    const { data: allProjects } = await supabase
      .from('spaces')
      .select('id, name, user_id, parent_id, category')
      .eq('category', 'project')
      .order('name');
    
    if (allProjects && allProjects.length > 0) {
      console.log(`Total de proyectos: ${allProjects.length}\n`);
      allProjects.forEach((p, idx) => {
        const parentInfo = p.parent_id ? `(Parent: ${p.parent_id})` : '(ROOT - sin parent)';
        console.log(`   ${idx + 1}. ${p.name} - ID: ${p.id} - User: ${p.user_id} ${parentInfo}`);
      });
      console.log('\n💡 Si ves el proyecto "días" en la lista, puedes ejecutar el script con el ID:');
      console.log('   node scripts/fix-dias-parent.js <ID_DEL_PROYECTO_DIAS>');
    }
    process.exit(0);
  }
  
  console.log(`📦 Encontrados ${diasProjects.length} proyecto(s) con "días":\n`);
  diasProjects.forEach(p => {
    console.log(`   - ${p.name} (ID: ${p.id}, User: ${p.user_id}, Parent: ${p.parent_id || 'NONE'})`);
  });
  
  // Agrupar por usuario
  const diasByUser = new Map();
  diasProjects.forEach(p => {
    if (!diasByUser.has(p.user_id)) {
      diasByUser.set(p.user_id, []);
    }
    diasByUser.get(p.user_id).push(p);
  });
  
  let totalFixed = 0;
  
  for (const [userId, userDiasProjects] of diasByUser.entries()) {
    console.log(`\n👤 Procesando usuario ${userId}...`);
    
    // Si hay múltiples proyectos "días" para el mismo usuario, usar el que no tiene parent_id
    // o el más antiguo
    let diasProject = userDiasProjects.find(p => !p.parent_id);
    if (!diasProject) {
      // Si todos tienen parent_id, usar el más antiguo (menor ID generalmente)
      diasProject = userDiasProjects.sort((a, b) => a.id.localeCompare(b.id))[0];
      console.log(`   ⚠️  Todos los proyectos "días" tienen parent_id, usando: ${diasProject.name} (${diasProject.id})`);
    }
    
    console.log(`   📌 Proyecto "días" seleccionado: ${diasProject.name} (${diasProject.id})`);
    
    // 1. Asegurar que "días" no tenga parent_id (sea el root)
    if (diasProject.parent_id) {
      console.log(`   🔧 Removiendo parent_id de "días" (era: ${diasProject.parent_id})`);
      const { error: updateError } = await supabase
        .from('spaces')
        .update({ parent_id: null })
        .eq('id', diasProject.id);
      
      if (updateError) {
        console.error(`   ❌ Error removiendo parent_id:`, updateError);
        continue;
      } else {
        console.log(`   ✅ "días" ahora es el parent raíz`);
        totalFixed++;
      }
    } else {
      console.log(`   ✅ "días" ya es el parent raíz`);
    }
    
    // 2. Obtener todos los proyectos del mismo usuario
    const { data: allUserProjects, error: projectsError } = await supabase
      .from('spaces')
      .select('id, name, parent_id')
      .eq('user_id', userId)
      .eq('category', 'project')
      .neq('id', diasProject.id); // Excluir "días" mismo
    
    if (projectsError) {
      console.error(`   ❌ Error obteniendo proyectos del usuario:`, projectsError);
      continue;
    }
    
    if (!allUserProjects || allUserProjects.length === 0) {
      console.log(`   ℹ️  No hay otros proyectos para este usuario`);
      continue;
    }
    
    console.log(`   📦 Encontrados ${allUserProjects.length} otros proyectos`);
    
    // 3. Actualizar todos los proyectos para que tengan "días" como parent
    let updatedCount = 0;
    for (const project of allUserProjects) {
      if (project.parent_id !== diasProject.id) {
        console.log(`   🔧 Actualizando ${project.name} (${project.id})`);
        console.log(`      Parent anterior: ${project.parent_id || 'NONE'} → Nuevo: ${diasProject.id}`);
        
        const { error: updateError } = await supabase
          .from('spaces')
          .update({ parent_id: diasProject.id })
          .eq('id', project.id);
        
        if (updateError) {
          console.error(`      ❌ Error:`, updateError);
        } else {
          console.log(`      ✅ Actualizado`);
          updatedCount++;
          totalFixed++;
        }
      } else {
        console.log(`   ✓ ${project.name} ya tiene "días" como parent`);
      }
    }
    
    console.log(`   ✅ Actualizados ${updatedCount} proyectos para este usuario`);
  }
  
  console.log(`\n✨ Total de correcciones: ${totalFixed}`);
  console.log('✅ ¡Listo! "días" ahora es el parent raíz de todos los proyectos.');
}

// Si se proporciona un ID como argumento, usarlo directamente
const diasIdArg = process.argv[2];

if (diasIdArg) {
  // Modo: usar el ID proporcionado
  (async () => {
    console.log(`🔍 Usando proyecto con ID: ${diasIdArg}\n`);
    
    const { data: diasProject, error } = await supabase
      .from('spaces')
      .select('id, name, user_id, parent_id, category')
      .eq('id', diasIdArg)
      .eq('category', 'project')
      .single();
    
    if (error || !diasProject) {
      console.error('❌ No se encontró un proyecto con ese ID:', error);
      process.exit(1);
    }
    
    console.log(`📌 Proyecto encontrado: ${diasProject.name} (${diasProject.id})`);
    
    // Asegurar que no tenga parent_id
    if (diasProject.parent_id) {
      console.log(`🔧 Removiendo parent_id de "${diasProject.name}" (era: ${diasProject.parent_id})`);
      const { error: updateError } = await supabase
        .from('spaces')
        .update({ parent_id: null })
        .eq('id', diasProject.id);
      
      if (updateError) {
        console.error('❌ Error:', updateError);
        process.exit(1);
      }
      console.log('✅ Ahora es el parent raíz');
    }
    
    // Actualizar todos los demás proyectos del mismo usuario
    const { data: otherProjects } = await supabase
      .from('spaces')
      .select('id, name, parent_id')
      .eq('user_id', diasProject.user_id)
      .eq('category', 'project')
      .neq('id', diasProject.id);
    
    if (otherProjects && otherProjects.length > 0) {
      console.log(`\n📦 Actualizando ${otherProjects.length} otros proyectos...`);
      let updated = 0;
      for (const project of otherProjects) {
        if (project.parent_id !== diasProject.id) {
          await supabase
            .from('spaces')
            .update({ parent_id: diasProject.id })
            .eq('id', project.id);
          updated++;
        }
      }
      console.log(`✅ ${updated} proyectos actualizados`);
    }
    
    console.log('\n🎉 ¡Completado!');
    process.exit(0);
  })();
} else {
  // Modo normal: buscar por nombre
  fixDiasParent()
    .then(() => {
      console.log('\n🎉 ¡Completado!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Error:', error);
      process.exit(1);
    });
}

