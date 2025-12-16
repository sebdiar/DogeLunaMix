// Script para eliminar usuarios no deseados
// Ejecutar desde el directorio backend: node delete-users.js

import supabase from './config/database.js';

// Usuarios a eliminar (por nombre o email)
const usersToDelete = ['demo', 'Mulham', 'Test'];

async function deleteUsers() {
  console.log('🔍 Buscando usuarios a eliminar...\n');
  
  for (const userName of usersToDelete) {
    try {
      // Buscar usuario por nombre o email
      const { data: users, error: searchError } = await supabase
        .from('users')
        .select('id, email, name')
        .or(`name.ilike.%${userName}%,email.ilike.%${userName}%`);
      
      if (searchError) {
        console.error(`❌ Error buscando usuario "${userName}":`, searchError);
        continue;
      }
      
      if (!users || users.length === 0) {
        console.log(`ℹ️  Usuario "${userName}" no encontrado`);
        continue;
      }
      
      for (const user of users) {
        console.log(`🗑️  Eliminando usuario: ${user.name || user.email} (${user.id})`);
        
        const { error: deleteError } = await supabase
          .from('users')
          .delete()
          .eq('id', user.id);
        
        if (deleteError) {
          console.error(`❌ Error eliminando usuario "${user.name || user.email}":`, deleteError);
        } else {
          console.log(`✅ Usuario "${user.name || user.email}" eliminado exitosamente\n`);
        }
      }
    } catch (error) {
      console.error(`❌ Error procesando usuario "${userName}":`, error);
    }
  }
  
  console.log('✨ Proceso completado');
}

deleteUsers().catch(console.error);










