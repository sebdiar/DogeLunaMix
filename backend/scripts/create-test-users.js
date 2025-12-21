import bcrypt from 'bcryptjs';
import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function createTestUsers() {
  try {
    console.log('🔧 Creando usuarios de prueba...\n');

    // Usuario 1
    const passwordHash1 = await bcrypt.hash('1', 10);
    const { data: user1, error: error1 } = await supabase
      .from('users')
      .insert({
        email: '1',
        password_hash: passwordHash1,
        name: '1',
        avatar_photo: 'https://api.dicebear.com/7.x/avataaars/svg?seed=user1&backgroundColor=b6e3f4,c0aede,d1d4f9'
      })
      .select('id, email, name, avatar_photo')
      .single();

    if (error1) {
      if (error1.code === '23505') {
        console.log('⚠️  Usuario 1 ya existe (email: 1)');
      } else {
        console.error('❌ Error creando usuario 1:', error1);
      }
    } else {
      console.log('✅ Usuario 1 creado:');
      console.log('   - Email: 1');
      console.log('   - Password: 1');
      console.log('   - Name: 1');
      console.log('   - ID:', user1.id);
      console.log('   - Avatar:', user1.avatar_photo);
      console.log('');
    }

    // Usuario 2
    const passwordHash2 = await bcrypt.hash('2', 10);
    const { data: user2, error: error2 } = await supabase
      .from('users')
      .insert({
        email: '2',
        password_hash: passwordHash2,
        name: '2',
        avatar_photo: 'https://api.dicebear.com/7.x/avataaars/svg?seed=user2&backgroundColor=ffd5dc,ffdfbf'
      })
      .select('id, email, name, avatar_photo')
      .single();

    if (error2) {
      if (error2.code === '23505') {
        console.log('⚠️  Usuario 2 ya existe (email: 2)');
      } else {
        console.error('❌ Error creando usuario 2:', error2);
      }
    } else {
      console.log('✅ Usuario 2 creado:');
      console.log('   - Email: 2');
      console.log('   - Password: 2');
      console.log('   - Name: 2');
      console.log('   - ID:', user2.id);
      console.log('   - Avatar:', user2.avatar_photo);
      console.log('');
    }

    console.log('✨ Proceso completado!');
    console.log('\n📝 Credenciales de prueba:');
    console.log('   Usuario 1: email="1", password="1"');
    console.log('   Usuario 2: email="2", password="2"');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  }
}

createTestUsers();


