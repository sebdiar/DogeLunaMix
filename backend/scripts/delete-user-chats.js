import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from backend/.env
config({ path: join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function deleteUserChats() {
  console.log('🗑️  Starting to delete all user chats (DMs)...\n');

  try {
    // Step 1: Get all user spaces
    console.log('📋 Step 1: Finding user spaces...');
    const { data: userSpaces, error: spacesError } = await supabase
      .from('spaces')
      .select('id, name')
      .eq('category', 'user');

    if (spacesError) throw spacesError;
    console.log(`   Found ${userSpaces?.length || 0} user spaces\n`);

    if (!userSpaces || userSpaces.length === 0) {
      console.log('✅ No user chats to delete. All clean!');
      return;
    }

    const userSpaceIds = userSpaces.map(s => s.id);

    // Step 2: Get chat IDs associated with user spaces
    console.log('📋 Step 2: Finding associated chats...');
    const { data: spaceChats, error: spaceChatsError } = await supabase
      .from('space_chats')
      .select('chat_id')
      .in('space_id', userSpaceIds);

    if (spaceChatsError) throw spaceChatsError;
    const chatIds = spaceChats?.map(sc => sc.chat_id) || [];
    console.log(`   Found ${chatIds.length} chats\n`);

    if (chatIds.length > 0) {
      // Step 3: Delete messages
      console.log('🗑️  Step 3: Deleting messages...');
      const { error: messagesError, count: messagesCount } = await supabase
        .from('chat_messages')
        .delete({ count: 'exact' })
        .in('chat_id', chatIds);

      if (messagesError) throw messagesError;
      console.log(`   Deleted ${messagesCount || 0} messages\n`);

      // Step 4: Delete participants
      console.log('🗑️  Step 4: Deleting chat participants...');
      const { error: participantsError, count: participantsCount } = await supabase
        .from('chat_participants')
        .delete({ count: 'exact' })
        .in('chat_id', chatIds);

      if (participantsError) throw participantsError;
      console.log(`   Deleted ${participantsCount || 0} participants\n`);

      // Step 5: Delete read status
      console.log('🗑️  Step 5: Deleting read status...');
      const { error: readsError, count: readsCount } = await supabase
        .from('chat_message_reads')
        .delete({ count: 'exact' })
        .in('chat_id', chatIds);

      if (readsError) throw readsError;
      console.log(`   Deleted ${readsCount || 0} read status entries\n`);
    }

    // Step 6: Delete space_chats relations
    console.log('🗑️  Step 6: Deleting space_chats relations...');
    const { error: spaceChatsDeleteError, count: spaceChatsCount } = await supabase
      .from('space_chats')
      .delete({ count: 'exact' })
      .in('space_id', userSpaceIds);

    if (spaceChatsDeleteError) throw spaceChatsDeleteError;
    console.log(`   Deleted ${spaceChatsCount || 0} space_chats relations\n`);

    // Step 7: Delete orphaned chats
    if (chatIds.length > 0) {
      console.log('🗑️  Step 7: Deleting orphaned chats...');
      const { error: chatsError, count: chatsCount } = await supabase
        .from('chats')
        .delete({ count: 'exact' })
        .in('id', chatIds);

      if (chatsError) throw chatsError;
      console.log(`   Deleted ${chatsCount || 0} chats\n`);
    }

    // Step 8: Delete user spaces
    console.log('🗑️  Step 8: Deleting user spaces...');
    const { error: spacesDeleteError, count: spacesCount } = await supabase
      .from('spaces')
      .delete({ count: 'exact' })
      .in('id', userSpaceIds);

    if (spacesDeleteError) throw spacesDeleteError;
    console.log(`   Deleted ${spacesCount || 0} spaces\n`);

    console.log('✅ Successfully deleted all user chats!');
    console.log('\n📊 Summary:');
    console.log(`   - User spaces deleted: ${spacesCount || 0}`);
    console.log(`   - Chats deleted: ${chatIds.length}`);
    console.log(`   - Messages deleted: ${messagesCount || 0}`);
    console.log(`   - Participants deleted: ${participantsCount || 0}`);
    console.log('\n💡 You can now create new chats from scratch using "New message"');

  } catch (error) {
    console.error('\n❌ Error deleting user chats:', error);
    process.exit(1);
  }
}

deleteUserChats();

