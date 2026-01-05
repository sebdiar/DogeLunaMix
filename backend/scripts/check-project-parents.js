/**
 * Check project parent-child relationships
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import supabase from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

const SEBASTIAN_USER_ID = 'dbc08b48-54d8-4aea-8444-f750ee515b02';

async function checkParents() {
  console.log('🔍 Checking project parent-child relationships...\n');
  
  const { data: projects, error } = await supabase
    .from('spaces')
    .select('id, name, parent_id, notion_page_id')
    .eq('user_id', SEBASTIAN_USER_ID)
    .eq('category', 'project')
    .order('name');

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log(`📊 Total projects: ${projects.length}\n`);
  
  // Check for "Area" projects specifically
  const areaProjects = projects.filter(p => 
    p.name.includes('Area') || 
    p.name.includes('área') ||
    p.name.includes('Área')
  );
  
  console.log(`🏢 Projects with "Area" in name: ${areaProjects.length}\n`);
  
  for (const area of areaProjects) {
    const parentId = area.parent_id;
    const parentArray = Array.isArray(parentId) ? parentId : (parentId ? [parentId] : []);
    
    // Find children (projects that have this area in their parent_id array)
    const children = projects.filter(p => {
      const pParentId = p.parent_id;
      const pParentArray = Array.isArray(pParentId) ? pParentId : (pParentId ? [pParentId] : []);
      return pParentArray.includes(area.id);
    });
    
    console.log(`  📁 ${area.name} (ID: ${area.id})`);
    console.log(`     Parent IDs: ${JSON.stringify(parentArray)}`);
    if (parentArray.length > 0) {
      const parentNames = parentArray.map(pid => {
        const parent = projects.find(p => p.id === pid);
        return parent ? parent.name : `[UNKNOWN: ${pid}]`;
      });
      console.log(`     Parent Names: ${parentNames.join(', ')}`);
    } else {
      console.log(`     Parent: ROOT (no parent)`);
    }
    console.log(`     Children: ${children.length} projects`);
    if (children.length > 0) {
      console.log(`     Child names:`);
      children.forEach(child => {
        console.log(`       - ${child.name}`);
      });
    }
    console.log('');
  }
  
  // Check projects with parents to see structure
  const withParents = projects.filter(p => {
    const parentId = p.parent_id;
    if (!parentId) return false;
    if (Array.isArray(parentId)) return parentId.length > 0;
    return true;
  });
  
  console.log(`\n📦 Projects with parents: ${withParents.length}`);
  console.log(`📦 Projects without parents (root): ${projects.length - withParents.length}\n`);
}

checkParents()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });

