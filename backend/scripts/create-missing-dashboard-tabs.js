/**
 * Script para crear tabs de Dashboard para todos los proyectos que tengan notion_page_url
 * pero que no tengan un tab de Dashboard ya creado.
 * 
 * Ejecutar con: node backend/scripts/create-missing-dashboard-tabs.js
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function createMissingDashboardTabs() {
  console.log('🔍 Buscando proyectos con notion_page_url que no tengan tab de Dashboard...\n');

  try {
    // 1. Obtener todos los espacios (proyectos) que tengan notion_page_url
    const { data: spaces, error: spacesError } = await supabase
      .from('spaces')
      .select('id, name, user_id, notion_page_url')
      .not('notion_page_url', 'is', null)
      .eq('archived', false);

    if (spacesError) {
      console.error('❌ Error al obtener espacios:', spacesError);
      process.exit(1);
    }

    if (!spaces || spaces.length === 0) {
      console.log('✅ No se encontraron proyectos con notion_page_url.');
      return;
    }

    console.log(`📊 Encontrados ${spaces.length} proyectos con notion_page_url.\n`);

    let created = 0;
    let skipped = 0;
    let errors = 0;

    // 2. Para cada espacio, verificar si ya tiene un tab de Dashboard
    for (const space of spaces) {
      try {
        // Buscar si ya existe un tab de Dashboard para este espacio
        // Un tab de Dashboard es uno que:
        // - Pertenece al espacio (space_id = space.id)
        // - Tiene title = 'Dashboard' O tiene la misma URL que notion_page_url
        const { data: existingTabs, error: tabsError } = await supabase
          .from('tabs')
          .select('id, title, url')
          .eq('space_id', space.id)
          .or(`title.eq.Dashboard,url.eq.${space.notion_page_url}`);

        if (tabsError) {
          console.error(`❌ Error al buscar tabs para espacio "${space.name}":`, tabsError);
          errors++;
          continue;
        }

        // Si ya existe un tab de Dashboard, saltarlo
        if (existingTabs && existingTabs.length > 0) {
          console.log(`⏭️  Espacio "${space.name}" ya tiene tab de Dashboard. Saltando...`);
          skipped++;
          continue;
        }

        // 3. Obtener la posición máxima de los tabs del espacio para colocar Dashboard después del Chat
        const { data: allSpaceTabs, error: allTabsError } = await supabase
          .from('tabs')
          .select('position')
          .eq('space_id', space.id)
          .order('position', { ascending: true });

        if (allTabsError) {
          console.error(`❌ Error al obtener tabs del espacio "${space.name}":`, allTabsError);
          errors++;
          continue;
        }

        // Calcular posición: si hay tabs, usar la máxima + 1, sino usar 1 (Chat está en 0)
        let position = 1; // Por defecto, Dashboard va después del Chat (posición 0)
        if (allSpaceTabs && allSpaceTabs.length > 0) {
          const maxPosition = Math.max(...allSpaceTabs.map(t => t.position || 0));
          // Si el Chat está en posición 0, Dashboard va en 1
          // Si hay otros tabs, Dashboard va después del último
          position = maxPosition + 1;
        }

        // 4. Crear el tab de Dashboard
        const { data: newTab, error: createError } = await supabase
          .from('tabs')
          .insert({
            user_id: space.user_id,
            space_id: space.id,
            title: 'Dashboard',
            url: space.notion_page_url,
            bookmark_url: space.notion_page_url,
            type: 'browser',
            position: position,
            cookie_container_id: 'default'
          })
          .select()
          .single();

        if (createError) {
          console.error(`❌ Error al crear tab de Dashboard para espacio "${space.name}":`, createError);
          errors++;
          continue;
        }

        console.log(`✅ Creado tab de Dashboard para espacio "${space.name}" (posición ${position})`);
        created++;
      } catch (error) {
        console.error(`❌ Error procesando espacio "${space.name}":`, error);
        errors++;
      }
    }

    console.log('\n📊 Resumen:');
    console.log(`   ✅ Creados: ${created}`);
    console.log(`   ⏭️  Saltados (ya existían): ${skipped}`);
    console.log(`   ❌ Errores: ${errors}`);
    console.log(`   📦 Total procesados: ${spaces.length}`);

  } catch (error) {
    console.error('❌ Error general:', error);
    process.exit(1);
  }
}

// Ejecutar el script
createMissingDashboardTabs()
  .then(() => {
    console.log('\n✅ Script completado.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  });

