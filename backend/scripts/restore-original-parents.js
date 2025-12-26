/**
 * Script para restaurar la estructura ORIGINAL de parent_id
 * Basado en la lista que obtuve antes de hacer cambios
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

// Estructura ORIGINAL de parent_id que obtuve antes de hacer cambios
const originalStructure = {
  '0b52c484-c725-49e8-aa2c-9bb4014c8c53': '82b4d9b0-f182-41d7-aa91-1c2fa1fa6ec6', // Agent 1 V6 -> Sora Video
  '4aecdefc-fd81-467e-8199-a94780bdf1c9': '82b4d9b0-f182-41d7-aa91-1c2fa1fa6ec6', // Agent 2 V2 -> Sora Video
  '14adb1ff-5ce1-4aee-89a0-f77a20d2ce0c': '82b4d9b0-f182-41d7-aa91-1c2fa1fa6ec6', // Agent 3 V2 -> Sora Video
  '5d0890c1-84c9-400a-b8dd-cb6e21dd784a': '82b4d9b0-f182-41d7-aa91-1c2fa1fa6ec6', // Agent 3 V3 -> Sora Video
  '257b0cef-58f0-4de6-8326-b52b9c6f7851': '82b4d9b0-f182-41d7-aa91-1c2fa1fa6ec6', // Agent 4 -> Sora Video
  'eca618a2-9931-463c-b554-dc7679a11fd9': '82b4d9b0-f182-41d7-aa91-1c2fa1fa6ec6', // Agent 5 -> Sora Video
  '3fe0367f-7988-4e25-aadd-10ef95312a6d': null, // 123 -> ROOT
  '31f20fb4-5556-4add-9578-d58e4f8034e1': 'f68b7b4c-5f73-48f3-9fd6-53812ddf76cf', // Accounting -> Amazon
  'e252c3cf-9115-40b4-bfdf-c95303025d05': null, // AI Agents -> ROOT
  'f68b7b4c-5f73-48f3-9fd6-53812ddf76cf': '5cfdecea-29d5-4092-a925-fab2be5306d4', // Amazon -> DIAZ
  '190b2cff-35e2-444e-b529-99c717d2fce4': null, // Apps -> ROOT
  '7bacd24a-3f10-443a-82b8-69b2a852eb9b': '3ff10545-e10a-4010-8629-c884d1600929', // Bodega -> Teneria
  '6340940d-5637-4be1-b20d-927609f4d782': 'f68b7b4c-5f73-48f3-9fd6-53812ddf76cf', // Catalog -> Amazon
  '5e250c2e-ab3d-46bf-a283-2d433c69a944': 'db669d2e-de26-4e1a-af76-5477839c68a5', // Catalog -> Tiktok
  '0625e570-0975-4363-8469-31bc6d63c61c': null, // Compartido -> ROOT
  '99b8bf71-534f-49ce-97f3-7ffcf281ed69': '3ff10545-e10a-4010-8629-c884d1600929', // Confexión -> Teneria
  '3fc7f1bb-5108-422a-8c97-ae990569b6fe': '3ff10545-e10a-4010-8629-c884d1600929', // Conta -> Teneria
  'de6321bf-ca2f-45b6-a543-8d4964298884': 'db669d2e-de26-4e1a-af76-5477839c68a5', // Content -> Tiktok
  '1e1d6ab7-a703-41a4-8590-cd68b83ba984': '3ff10545-e10a-4010-8629-c884d1600929', // Design -> Teneria
  '5cfdecea-29d5-4092-a925-fab2be5306d4': 'f68b7b4c-5f73-48f3-9fd6-53812ddf76cf', // DIAZ -> Amazon
  '4360a2e2-6dee-4d0f-ae64-a57a88780dbe': 'ff8d5451-b98c-444f-89c0-df712592c321', // Festivities -> Personal
  'c484bba8-2ecb-482a-b2d1-f668a368e2ca': '02c3acb7-2faa-45ab-8a59-324d39ab3564', // Habit 3 Cursor -> Habit Tracker
  '02c3acb7-2faa-45ab-8a59-324d39ab3564': null, // Habit Tracker -> ROOT
  '98b39f65-9572-455b-a3b8-d63cdcef256c': '02c3acb7-2faa-45ab-8a59-324d39ab3564', // Habit Tracker  -> Habit Tracker
  '971e47b3-d679-4a16-b9c0-b4c9581b398c': '02c3acb7-2faa-45ab-8a59-324d39ab3564', // Habit Tracker 2 -> Habit Tracker
  '0ddcdc0e-b74b-48bb-b861-8dfe70e8c968': '190b2cff-35e2-444e-b529-99c717d2fce4', // HabitAi -> Apps
  '8da1c110-51ca-4ce5-9e83-560e99974a3b': 'ff8d5451-b98c-444f-89c0-df712592c321', // Home -> Personal
  '3286a708-1352-417c-bba1-d61038e4e7f5': '3ff10545-e10a-4010-8629-c884d1600929', // Leather -> Teneria
  '12cbc721-bc4b-42cc-a12f-4cbd14b31d0a': 'f68b7b4c-5f73-48f3-9fd6-53812ddf76cf', // Logistics -> Amazon
  '7846692a-a109-460e-b0bb-a455d204660d': null, // NEW PROJECT -> ROOT
  '47aec037-a97a-47b5-b668-ae9f8086fda2': '190b2cff-35e2-444e-b529-99c717d2fce4', // OpsApp -> Apps
  'ff8d5451-b98c-444f-89c0-df712592c321': null, // Personal -> ROOT
  '136621d5-ec2d-453e-a20b-f6254e1849b2': 'f68b7b4c-5f73-48f3-9fd6-53812ddf76cf', // PPC -> Amazon
  '5f2f7d79-ba36-42a3-849d-1d91c51debde': 'db669d2e-de26-4e1a-af76-5477839c68a5', // Product -> Tiktok
  '7d196b1d-aa0a-4835-b1bf-6394243264df': '5cfdecea-29d5-4092-a925-fab2be5306d4', // Shopify -> DIAZ
  '82b4d9b0-f182-41d7-aa91-1c2fa1fa6ec6': 'e252c3cf-9115-40b4-bfdf-c95303025d05', // Sora Video -> AI Agents
  '3ff10545-e10a-4010-8629-c884d1600929': '5cfdecea-29d5-4092-a925-fab2be5306d4', // Teneria -> DIAZ
  'db669d2e-de26-4e1a-af76-5477839c68a5': '5cfdecea-29d5-4092-a925-fab2be5306d4', // Tiktok -> DIAZ
  '82ea6edb-5260-4a4e-a6fc-819d822e7089': '7d196b1d-aa0a-4835-b1bf-6394243264df', // Website -> Shopify
  'f8b70838-f6b9-483c-b939-825635a8b167': null, // WORKING? -> ROOT
};

async function restoreOriginalParents() {
  console.log('🔧 Restaurando estructura ORIGINAL de parent_id...\n');
  
  let restoredCount = 0;
  let errorCount = 0;
  
  for (const [projectId, originalParentId] of Object.entries(originalStructure)) {
    const { data: project } = await supabase
      .from('spaces')
      .select('id, name, parent_id')
      .eq('id', projectId)
      .single();
    
    if (!project) {
      console.log(`⚠️  Proyecto ${projectId} no encontrado, saltando...`);
      continue;
    }
    
    const parentInfo = originalParentId ? `parent: ${originalParentId}` : 'sin parent (ROOT)';
    const currentInfo = project.parent_id ? `parent actual: ${project.parent_id}` : 'sin parent';
    
    if (project.parent_id !== originalParentId) {
      console.log(`🔧 ${project.name}: ${currentInfo} → ${parentInfo}`);
      
      const { error: updateError } = await supabase
        .from('spaces')
        .update({ parent_id: originalParentId })
        .eq('id', projectId);
      
      if (updateError) {
        console.error(`   ❌ Error:`, updateError);
        errorCount++;
      } else {
        console.log(`   ✅ Restaurado`);
        restoredCount++;
      }
    } else {
      console.log(`✓ ${project.name}: ya tiene el parent correcto`);
    }
  }
  
  console.log(`\n✅ ${restoredCount} proyectos restaurados`);
  if (errorCount > 0) {
    console.log(`⚠️  ${errorCount} errores`);
  }
  console.log('\n🎉 Estructura original restaurada');
}

restoreOriginalParents()
  .then(() => {
    console.log('\n✨ ¡Completado!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });

