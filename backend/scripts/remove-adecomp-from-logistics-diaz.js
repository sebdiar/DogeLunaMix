/**
 * Remove "ADECOMP" parent from "Logistics DIAZ" project
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import supabase from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

async function removeAdecompFromLogisticsDiaz() {
  try {
    console.log('🔍 Buscando "Logistics DIAZ" y "ADECOMP"...\n');

    // Find "Logistics DIAZ" project
    const { data: logisticsDiaz, error: findLogisticsError } = await supabase
      .from('spaces')
      .select('id, name, parent_id, user_id, category')
      .eq('category', 'project')
      .ilike('name', '%Logistics DIAZ%')
      .maybeSingle();

    if (findLogisticsError) {
      console.error('❌ Error buscando "Logistics DIAZ":', findLogisticsError);
      return;
    }

    if (!logisticsDiaz) {
      console.log('❌ Proyecto "Logistics DIAZ" no encontrado');
      return;
    }

    console.log('✅ Encontrado "Logistics DIAZ":');
    console.log(`   ID: ${logisticsDiaz.id}`);
    console.log(`   Nombre: ${logisticsDiaz.name}`);
    console.log(`   User ID: ${logisticsDiaz.user_id}`);

    // Parse current parent_id array
    let parentIds = logisticsDiaz.parent_id || [];
    if (!Array.isArray(parentIds)) {
      parentIds = parentIds ? [parentIds] : [];
    }
    
    console.log(`\n📋 Parents actuales: ${parentIds.length}`);
    console.log(`   Parent IDs: ${JSON.stringify(parentIds)}`);

    if (parentIds.length === 0) {
      console.log('\n✅ "Logistics DIAZ" no tiene parents, no hay nada que remover');
      return;
    }

    // Find all parent projects to identify which one is ADECOMP
    console.log('\n🔍 Buscando parents...');
    const { data: parentProjects, error: parentsError } = await supabase
      .from('spaces')
      .select('id, name')
      .in('id', parentIds)
      .eq('category', 'project');

    if (parentsError) {
      console.error('❌ Error buscando parents:', parentsError);
      return;
    }

    if (!parentProjects || parentProjects.length === 0) {
      console.log('⚠️  No se encontraron parents válidos');
      return;
    }

    console.log('\n📋 Parents encontrados:');
    parentProjects.forEach(parent => {
      console.log(`   - "${parent.name}" (ID: ${parent.id})`);
    });

    // Find ADECOMP
    const adecomp = parentProjects.find(p => 
      p.name && (p.name.includes('ADECOMP') || p.name.includes('Adecomp'))
    );

    if (!adecomp) {
      console.log('\n⚠️  No se encontró "ADECOMP" en los parents de "Logistics DIAZ"');
      console.log('   Parents actuales:');
      parentProjects.forEach(p => console.log(`      - ${p.name}`));
      return;
    }

    console.log(`\n🎯 Encontrado "ADECOMP": "${adecomp.name}" (ID: ${adecomp.id})`);

    // Remove ADECOMP from parent_id array
    const newParentIds = parentIds.filter(id => id !== adecomp.id);

    console.log(`\n🔧 Removiendo "ADECOMP" del array de parents...`);
    console.log(`   Antes: ${parentIds.length} parents`);
    console.log(`   Después: ${newParentIds.length} parents`);

    if (newParentIds.length === parentIds.length) {
      console.log('⚠️  No se removió ningún parent (ADECOMP no estaba en el array)');
      return;
    }

    // Update the database
    const { error: updateError } = await supabase
      .from('spaces')
      .update({ parent_id: newParentIds })
      .eq('id', logisticsDiaz.id);

    if (updateError) {
      console.error('❌ Error actualizando parent_id:', updateError);
      return;
    }

    console.log('\n✅ ¡Completado!');
    console.log(`   "Logistics DIAZ" ahora tiene ${newParentIds.length} parent(s):`);
    
    // Show remaining parents
    if (newParentIds.length > 0) {
      const { data: remainingParents } = await supabase
        .from('spaces')
        .select('id, name')
        .in('id', newParentIds)
        .eq('category', 'project');
      
      if (remainingParents) {
        remainingParents.forEach(p => {
          console.log(`      - "${p.name}" (ID: ${p.id})`);
        });
      }
    } else {
      console.log('      (sin parents - nivel raíz)');
    }

  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  }
}

removeAdecompFromLogisticsDiaz()
  .then(() => {
    console.log('\n🎉 ¡Proceso completado!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });

