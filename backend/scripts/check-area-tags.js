/**
 * Check tags for areas and their children
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import supabase from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

const SEBASTIAN_USER_ID = 'dbc08b48-54d8-4aea-8444-f750ee515b02';

async function checkAreaTags() {
  const { data: projects, error } = await supabase
    .from('spaces')
    .select('id, name, parent_id, tags')
    .eq('user_id', SEBASTIAN_USER_ID)
    .eq('category', 'project')
    .order('name');
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  const areas = projects.filter(p => 
    p.name.includes('Area') || 
    p.name.includes('área') ||
    p.name.includes('Área')
  );
  
  console.log('\n🏢 AREAS:\n');
  for (const area of areas.slice(0, 5)) {
    const tags = Array.isArray(area.tags) ? area.tags : (area.tags ? JSON.parse(area.tags) : []);
    const children = projects.filter(p => {
      const pParentId = Array.isArray(p.parent_id) ? p.parent_id : (p.parent_id ? [p.parent_id] : []);
      return pParentId.includes(area.id);
    });
    
    console.log(`  ${area.name}`);
    console.log(`    Tags: ${JSON.stringify(tags)}`);
    console.log(`    Children: ${children.length}`);
    if (children.length > 0) {
      for (const child of children.slice(0, 3)) {
        const childTags = Array.isArray(child.tags) ? child.tags : (child.tags ? JSON.parse(child.tags) : []);
        console.log(`      - "${child.name}" tags: ${JSON.stringify(childTags)}`);
      }
    }
    console.log('');
  }
}

checkAreaTags()
  .then(() => {
    console.log('✅ Done!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });

