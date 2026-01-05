/**
 * Check if projects have double parents (cliente + área)
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import supabase from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

const SEBASTIAN_USER_ID = 'dbc08b48-54d8-4aea-8444-f750ee515b02';

async function checkDoubleParents() {
  console.log('🔍 Checking double parents (cliente + área)...\n');
  
  const { data: projects, error } = await supabase
    .from('spaces')
    .select('id, name, parent_id, tags, notion_page_id')
    .eq('user_id', SEBASTIAN_USER_ID)
    .eq('category', 'project')
    .order('name');

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  // Find Area projects
  const areaProjects = projects.filter(p => 
    (p.name.includes('Area') || p.name.includes('área')) && 
    !p.name.includes('Account Health') // Exclude for now
  );
  
  const areaIds = new Set(areaProjects.map(a => a.id));
  
  // Find "shipments" as reference (working example)
  const shipments = projects.filter(p => 
    p.name.toLowerCase().includes('shipment')
  );
  
  console.log(`📦 Total projects: ${projects.length}`);
  console.log(`🏢 Area projects: ${areaProjects.length}`);
  console.log(`📦 Shipments projects: ${shipments.length}\n`);
  
  // Check shipments first (working example)
  console.log('📦 SHIPMENTS (working example):\n');
  for (const shipment of shipments.slice(0, 5)) {
    const parentId = shipment.parent_id;
    const parentArray = Array.isArray(parentId) ? parentId : (parentId ? [parentId] : []);
    
    const parentNames = parentArray.map(pid => {
      const parent = projects.find(p => p.id === pid);
      return parent ? parent.name : `[UNKNOWN: ${pid}]`;
    });
    
    const hasArea = parentArray.some(pid => areaIds.has(pid));
    const hasClient = parentArray.some(pid => !areaIds.has(pid));
    
    console.log(`  ${shipment.name}`);
    console.log(`    Parent IDs: ${JSON.stringify(parentArray)}`);
    console.log(`    Parent Names: ${parentNames.join(', ') || 'NONE'}`);
    console.log(`    Has Area: ${hasArea ? '✅' : '❌'}, Has Client: ${hasClient ? '✅' : '❌'}, Total parents: ${parentArray.length}`);
    console.log('');
  }
  
  // Check projects that should have double parents (have tags and should be under an area)
  console.log('\n📊 PROJECTS THAT SHOULD HAVE DOUBLE PARENTS:\n');
  
  let withDoubleParents = 0;
  let missingAreaParent = 0;
  let missingClientParent = 0;
  let singleParent = 0;
  
  for (const project of projects) {
    // Skip areas themselves
    if (areaIds.has(project.id)) continue;
    
    const parentId = project.parent_id;
    const parentArray = Array.isArray(parentId) ? parentId : (parentId ? [parentId] : []);
    
    if (parentArray.length === 0) continue; // Skip root projects
    
    const hasArea = parentArray.some(pid => areaIds.has(pid));
    const hasClient = parentArray.some(pid => !areaIds.has(pid));
    
    if (parentArray.length >= 2) {
      withDoubleParents++;
      // Show first 10 examples
      if (withDoubleParents <= 10) {
        const parentNames = parentArray.map(pid => {
          const parent = projects.find(p => p.id === pid);
          return parent ? parent.name : `[UNKNOWN: ${pid}]`;
        });
        
        console.log(`  ✅ ${project.name}`);
        console.log(`     Parents: ${parentNames.join(', ')} (${parentArray.length} total)`);
      }
    } else if (hasArea && !hasClient) {
      missingClientParent++;
    } else if (hasClient && !hasArea) {
      missingAreaParent++;
    } else {
      singleParent++;
    }
  }
  
  console.log(`\n📊 SUMMARY:`);
  console.log(`  ✅ Projects with double parents: ${withDoubleParents}`);
  console.log(`  ❌ Projects missing area parent: ${missingAreaParent}`);
  console.log(`  ❌ Projects missing client parent: ${missingClientParent}`);
  console.log(`  📦 Projects with single parent: ${singleParent}`);
  
  // Show some examples of projects missing area parent
  if (missingAreaParent > 0) {
    console.log(`\n❌ EXAMPLES OF PROJECTS MISSING AREA PARENT:\n`);
    let shown = 0;
    for (const project of projects) {
      if (areaIds.has(project.id)) continue;
      
      const parentId = project.parent_id;
      const parentArray = Array.isArray(parentId) ? parentId : (parentId ? [parentId] : []);
      
      if (parentArray.length === 0) continue;
      
      const hasArea = parentArray.some(pid => areaIds.has(pid));
      const hasClient = parentArray.some(pid => !areaIds.has(pid));
      
      if (hasClient && !hasArea && shown < 10) {
        const parentNames = parentArray.map(pid => {
          const parent = projects.find(p => p.id === pid);
          return parent ? parent.name : `[UNKNOWN: ${pid}]`;
        });
        
        console.log(`  ${project.name}`);
        console.log(`    Current parents: ${parentNames.join(', ')}`);
        console.log(`    Missing: Area parent`);
        console.log('');
        shown++;
      }
    }
  }
}

checkDoubleParents()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });

