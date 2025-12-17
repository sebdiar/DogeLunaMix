import express from 'express';
import supabase from '../config/database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

// Helper: Get or create chat for a space
async function getOrCreateChatForSpace(spaceId, userId) {
  // First, get the space to check if it's a user space (DM)
  const { data: space } = await supabase
    .from('spaces')
    .select('id, category, name, user_id, notion_page_id')
    .eq('id', spaceId)
    .single();
  
  if (!space) return null;
  
  // Check if chat already exists for this space
  const { data: spaceChat } = await supabase
    .from('space_chats')
    .select('chat_id')
    .eq('space_id', spaceId)
    .single();
  
  if (spaceChat) {
    // Chat exists - ensure user is a participant
    const { data: existingParticipant } = await supabase
      .from('chat_participants')
      .select('id')
      .eq('chat_id', spaceChat.chat_id)
      .eq('user_id', userId)
      .single();
    
    if (!existingParticipant) {
      await supabase
        .from('chat_participants')
        .insert({ chat_id: spaceChat.chat_id, user_id: userId });
    }
    
    return spaceChat.chat_id;
  }
  
  // For projects with notion_page_id, check if there's already a shared chat
  let sharedChatId = null;
  if (space.category === 'project' && space.notion_page_id) {
    // Find other spaces with the same notion_page_id that have a chat
    const { data: otherSpaces } = await supabase
      .from('spaces')
      .select('id')
      .eq('notion_page_id', space.notion_page_id)
      .eq('category', 'project')
      .neq('id', spaceId);
    
    if (otherSpaces && otherSpaces.length > 0) {
      const otherSpaceIds = otherSpaces.map(s => s.id);
      const { data: existingSpaceChats } = await supabase
        .from('space_chats')
        .select('chat_id')
        .in('space_id', otherSpaceIds)
        .limit(1)
        .single();
      
      if (existingSpaceChats) {
        sharedChatId = existingSpaceChats.chat_id;
      }
    }
  }
  
  let chatId;
  if (sharedChatId) {
    // Use the existing shared chat
    chatId = sharedChatId;
    await supabase
      .from('space_chats')
      .insert({ space_id: spaceId, chat_id: chatId });
  } else {
    // Create new chat
    const { data: chat } = await supabase
      .from('chats')
      .insert({})
      .select('id')
      .single();
    
    if (!chat) return null;
    chatId = chat.id;
    
    await supabase
      .from('space_chats')
      .insert({ space_id: spaceId, chat_id: chatId });
  }
  
  // Ensure user is a participant
  const { data: existingParticipant } = await supabase
    .from('chat_participants')
    .select('id')
    .eq('chat_id', chatId)
    .eq('user_id', userId)
    .single();
  
  if (!existingParticipant) {
    await supabase
      .from('chat_participants')
      .insert({ chat_id: chatId, user_id: userId });
  }
  
  // For user spaces, add the other user as participant too
  if (space.category === 'user') {
    // Find the other user by name/email
    const { data: otherUser } = await supabase
      .from('users')
      .select('id')
      .or(`email.eq.${space.name},name.eq.${space.name}`)
      .neq('id', userId)
      .single();
    
    if (otherUser) {
      // Check if already participant
      const { data: otherParticipant } = await supabase
        .from('chat_participants')
        .select('id')
        .eq('chat_id', chatId)
        .eq('user_id', otherUser.id)
        .single();
      
      if (!otherParticipant) {
        await supabase
          .from('chat_participants')
          .insert({ chat_id: chatId, user_id: otherUser.id });
      }
    }
    
    // Also add the space owner if different from current user
    if (space.user_id && space.user_id !== userId) {
      const { data: ownerParticipant } = await supabase
        .from('chat_participants')
        .select('id')
        .eq('chat_id', chatId)
        .eq('user_id', space.user_id)
        .single();
      
      if (!ownerParticipant) {
        await supabase
          .from('chat_participants')
          .insert({ chat_id: chatId, user_id: space.user_id });
      }
    }
  }
  
  return chatId;
}

// Get project members (participants in the chat for a space)
// IMPORTANT: This route must come BEFORE /space/:spaceId to avoid route conflicts
router.get('/space/:spaceId/members', async (req, res) => {
  try {
    const { spaceId } = req.params;
    
    // Get the space to verify it exists and get the owner
    const { data: space, error: spaceError } = await supabase
      .from('spaces')
      .select('id, category, user_id')
      .eq('id', spaceId)
      .single();
    
    if (spaceError || !space) {
      return res.status(404).json({ error: 'Space not found' });
    }
    
    // For projects, check if user is the owner OR a member
    if (space.category === 'project') {
      const isOwner = space.user_id === req.userId;
      
      if (!isOwner) {
        // Check if user is a member (participant in the chat)
        const { data: spaceChat } = await supabase
          .from('space_chats')
          .select('chat_id')
          .eq('space_id', spaceId)
          .maybeSingle();
        
        if (spaceChat) {
          const { data: participant } = await supabase
            .from('chat_participants')
            .select('id')
            .eq('chat_id', spaceChat.chat_id)
            .eq('user_id', req.userId)
            .single();
          
          if (!participant) {
            return res.status(403).json({ error: 'Access denied. Only project members can view members.' });
          }
        } else {
          return res.status(403).json({ error: 'Access denied. Only project members can view members.' });
        }
      }
    }
    
    const members = [];
    const existingIds = new Set();
    
    // Always include the space owner as a member (FIRST)
    // This is critical - the owner should always be shown, regardless of who is requesting
    if (space.user_id) {
      const { data: owner, error: ownerError } = await supabase
        .from('users')
        .select('id, name, email, avatar_photo')
        .eq('id', space.user_id)
        .maybeSingle();
      
      if (ownerError) {
        console.error('Error fetching owner:', ownerError);
      }
      
      if (owner) {
        members.push({
          id: owner.id,
          name: owner.name,
          email: owner.email,
          avatar_photo: owner.avatar_photo || null
        });
        existingIds.add(owner.id);
        console.log(`[GET MEMBERS] Added owner: ${owner.name} (${owner.id})`);
      } else {
        console.warn('Owner not found for space:', spaceId, 'user_id:', space.user_id);
      }
    } else {
      console.warn('Space has no user_id:', spaceId);
    }
    
    // For projects, show the owner (already added above) and all participants
    // For user spaces, show all participants
    if (space.category === 'project') {
      // Get the chat for this space
      const { data: spaceChat, error: spaceChatError } = await supabase
        .from('space_chats')
        .select('chat_id')
        .eq('space_id', spaceId)
        .maybeSingle();
      
      if (spaceChatError) {
        console.error('Error fetching space_chat:', spaceChatError);
      }
      
      if (spaceChat) {
        console.log(`[GET MEMBERS] Found chat: ${spaceChat.chat_id} for space: ${spaceId}`);
        
        // Get ALL participants in the chat (we'll filter out the owner if they're already added)
        const { data: participants, error: participantsError } = await supabase
          .from('chat_participants')
          .select('user_id, users!chat_participants_user_id_fkey(id, name, email, avatar_photo)')
          .eq('chat_id', spaceChat.chat_id);
        
        if (participantsError) {
          console.error('Error fetching participants:', participantsError);
        }
        
        console.log(`[GET MEMBERS] Found ${participants?.length || 0} participants in chat`);
        
        if (participants) {
          // Add all participants (excluding owner if already added to avoid duplicates)
          participants.forEach(p => {
            if (p.users) {
              console.log(`[GET MEMBERS] Processing participant: ${p.users.name} (${p.users.id}), already exists: ${existingIds.has(p.users.id)}`);
              if (!existingIds.has(p.users.id)) {
                members.push({
                  id: p.users.id,
                  name: p.users.name,
                  email: p.users.email,
                  avatar_photo: p.users.avatar_photo || null
                });
                existingIds.add(p.users.id);
                console.log(`[GET MEMBERS] Added participant: ${p.users.name}`);
              }
            }
          });
        }
      } else {
        console.warn(`[GET MEMBERS] No chat found for space: ${spaceId}`);
      }
    } else {
      // For user spaces (DMs), show all participants
      const { data: spaceChat, error: spaceChatError } = await supabase
        .from('space_chats')
        .select('chat_id')
        .eq('space_id', spaceId)
        .maybeSingle();
      
      if (!spaceChatError && spaceChat) {
        // Get all participants in the chat
        const { data: participants, error: participantsError } = await supabase
          .from('chat_participants')
          .select('user_id, users!chat_participants_user_id_fkey(id, name, email, avatar_photo)')
          .eq('chat_id', spaceChat.chat_id);
        
        if (!participantsError && participants) {
          // Add participants, avoiding duplicates (owner might already be a participant)
          participants.forEach(p => {
            if (p.users && !existingIds.has(p.users.id)) {
              members.push({
                id: p.users.id,
                name: p.users.name,
                email: p.users.email,
                avatar_photo: p.users.avatar_photo || null
              });
              existingIds.add(p.users.id);
            }
          });
        }
      }
    }
    
    console.log(`[GET MEMBERS] Returning ${members.length} members for space ${spaceId}, requested by user ${req.userId}`);
    res.json({ members });
  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({ error: 'Failed to get members' });
  }
});

// Get chat for a space
router.get('/space/:spaceId', async (req, res) => {
  try {
    const { spaceId } = req.params;
    
    const { data: space } = await supabase
      .from('spaces')
      .select('id, user_id, name, category')
      .eq('id', spaceId)
      .single();
    
    if (!space) {
      return res.status(404).json({ error: 'Space not found' });
    }
    
    let hasAccess = space.user_id === req.userId;
    
    // For projects, check if user is the owner OR a member
    if (space.category === 'project' && !hasAccess) {
      // Check if user is a member (participant in the chat)
      const { data: spaceChat } = await supabase
        .from('space_chats')
        .select('chat_id')
        .eq('space_id', spaceId)
        .maybeSingle();
      
      if (spaceChat) {
        const { data: participant } = await supabase
          .from('chat_participants')
          .select('id')
          .eq('chat_id', spaceChat.chat_id)
          .eq('user_id', req.userId)
          .single();
        
        hasAccess = !!participant;
      }
      
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied. Only project members can access this project.' });
      }
    }
    
    // For user spaces (DMs), check if current user is the other participant
    if (!hasAccess && space.category === 'user') {
      const { data: currentUser } = await supabase
        .from('users')
        .select('email, name')
        .eq('id', req.userId)
        .single();
      
      if (currentUser) {
        // Check if space name matches current user (meaning this is a DM where current user is the recipient)
        hasAccess = space.name === currentUser.email || space.name === currentUser.name;
        
        // Also check if there's a chat for this space and current user is a participant
        if (!hasAccess) {
          const { data: spaceChat } = await supabase
            .from('space_chats')
            .select('chat_id')
            .eq('space_id', spaceId)
            .single();
          
          if (spaceChat) {
            const { data: participant } = await supabase
              .from('chat_participants')
              .select('id')
              .eq('chat_id', spaceChat.chat_id)
              .eq('user_id', req.userId)
              .single();
            
            hasAccess = !!participant;
          }
        }
      }
    }
    
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const chatId = await getOrCreateChatForSpace(spaceId, req.userId);
    
    if (!chatId) {
      return res.status(500).json({ error: 'Failed to get chat' });
    }
    
    // For projects, only ensure the owner is a participant (don't auto-add others)
    // For user spaces, participants are already handled by getOrCreateChatForSpace
    if (space.category === 'project') {
      // Only verify owner is participant, don't auto-add
      const { data: participant } = await supabase
        .from('chat_participants')
        .select('id')
        .eq('chat_id', chatId)
        .eq('user_id', req.userId)
        .single();
      
      if (!participant) {
        // This should not happen for projects, but add owner if missing
        await supabase
          .from('chat_participants')
          .insert({ chat_id: chatId, user_id: req.userId });
      }
    } else {
      // For user spaces, ensure current user is a participant
      const { data: participant } = await supabase
        .from('chat_participants')
        .select('id')
        .eq('chat_id', chatId)
        .eq('user_id', req.userId)
        .single();
      
      if (!participant) {
        await supabase
          .from('chat_participants')
          .insert({ chat_id: chatId, user_id: req.userId });
      }
    }
    
    const { data: chat } = await supabase
      .from('chats')
      .select('*')
      .eq('id', chatId)
      .single();
    
    const { data: participants } = await supabase
      .from('chat_participants')
      .select('user_id, users!chat_participants_user_id_fkey(id, name, email)')
      .eq('chat_id', chatId);
    
    res.json({ 
      chat, 
      participants: participants?.map(p => p.users) || [] 
    });
  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({ error: 'Failed to get chat' });
  }
});

// Get messages for a chat
router.get('/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { limit = 50, before } = req.query;
    
    const { data: participant } = await supabase
      .from('chat_participants')
      .select('id')
      .eq('chat_id', chatId)
      .eq('user_id', req.userId)
      .single();
    
    if (!participant) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    let query = supabase
      .from('chat_messages')
      .select(`
        id,
        chat_id,
        user_id,
        message,
        created_at,
        user:users!chat_messages_user_id_fkey(id, name, email)
      `)
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false }) // Most recent first
      .limit(parseInt(limit));
    
    if (before) {
      query = query.lt('created_at', before);
    }
    
    const { data: messages, error } = await query;
    
    if (error) {
      console.error('Error fetching messages:', error);
      return res.status(500).json({ error: 'Failed to fetch messages' });
    }
    
    // Reverse to show oldest first (for chat UI)
    const sortedMessages = (messages || []).reverse();
    
    res.json({ messages: sortedMessages });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Send message
router.post('/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { message } = req.body;
    
    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message required' });
    }
    
    const { data: participant } = await supabase
      .from('chat_participants')
      .select('id')
      .eq('chat_id', chatId)
      .eq('user_id', req.userId)
      .single();
    
    if (!participant) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const { data: newMessage, error } = await supabase
      .from('chat_messages')
      .insert({
        chat_id: chatId,
        user_id: req.userId,
        message: message.trim()
      })
      .select(`
        id,
        chat_id,
        user_id,
        message,
        created_at,
        user:users!chat_messages_user_id_fkey(id, name, email)
      `)
      .single();
    
    if (error) {
      console.error('Error sending message:', error);
      return res.status(500).json({ error: 'Failed to send message' });
    }
    
    res.json({ message: newMessage });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Add members to project (add participants to chat)
router.post('/space/:spaceId/members', async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { userIds } = req.body;
    
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds array is required' });
    }
    
    // Verify the space exists and user is the owner
    const { data: space, error: spaceError } = await supabase
      .from('spaces')
      .select('id, category, user_id')
      .eq('id', spaceId)
      .single();
    
    if (spaceError || !space) {
      return res.status(404).json({ error: 'Space not found' });
    }
    
    // Only the owner can add members
    if (space.category === 'project' && space.user_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied. Only the project owner can add members.' });
    }
    
    // Get or create chat for this space
    const chatId = await getOrCreateChatForSpace(spaceId, req.userId);
    
    if (!chatId) {
      return res.status(500).json({ error: 'Failed to get chat' });
    }
    
    // Get current user info for notification message
    const { data: currentUser } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('id', req.userId)
      .single();
    
    // Add each user as a participant (ignore if already exists)
    const results = [];
    const addedUserNames = [];
    for (const userId of userIds) {
      // Check if already a participant
      const { data: existing } = await supabase
        .from('chat_participants')
        .select('id')
        .eq('chat_id', chatId)
        .eq('user_id', userId)
        .single();
      
      if (!existing) {
        const { error } = await supabase
          .from('chat_participants')
          .insert({ chat_id: chatId, user_id: userId });
        
        if (!error) {
          results.push(userId);
          
          // Get added user's name for notification
          const { data: addedUser } = await supabase
            .from('users')
            .select('name, email')
            .eq('id', userId)
            .single();
          
          if (addedUser) {
            addedUserNames.push(addedUser.name || addedUser.email);
          }
        }
      }
    }
    
    // Send notification message if users were added
    if (results.length > 0 && currentUser) {
      const userName = currentUser.name || currentUser.email;
      const usersList = addedUserNames.join(', ');
      const messageText = results.length === 1 
        ? `${userName} agregó a ${usersList} al proyecto`
        : `${userName} agregó a ${usersList} al proyecto`;
      
      // Insert system notification message (user_id null = system message)
      await supabase
        .from('chat_messages')
        .insert({
          chat_id: chatId,
          user_id: null, // null = system message
          message: messageText
        });
    }
    
    res.json({ success: true, added: results });
  } catch (error) {
    console.error('Add members error:', error);
    res.status(500).json({ error: 'Failed to add members' });
  }
});

// Remove members from project (remove participants from chat)
router.delete('/space/:spaceId/members', async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { userIds } = req.body;
    
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds array is required' });
    }
    
    // Verify the space exists and user is the owner
    const { data: space, error: spaceError } = await supabase
      .from('spaces')
      .select('id, category, user_id')
      .eq('id', spaceId)
      .single();
    
    if (spaceError || !space) {
      return res.status(404).json({ error: 'Space not found' });
    }
    
    // Only the owner can remove members
    if (space.category === 'project' && space.user_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied. Only the project owner can remove members.' });
    }
    
    // Get chat for this space
    const { data: spaceChat } = await supabase
      .from('space_chats')
      .select('chat_id')
      .eq('space_id', spaceId)
      .single();
    
    if (!spaceChat) {
      return res.status(404).json({ error: 'Chat not found for this space' });
    }
    
    // Remove participants (don't remove the current user if they're in the list)
    const userIdsToRemove = userIds.filter(id => id !== req.userId);
    
    if (userIdsToRemove.length > 0) {
      // Get user names before removing for notification
      const { data: removedUsers } = await supabase
        .from('users')
        .select('name, email')
        .in('id', userIdsToRemove);
      
      // Get current user info for notification message
      const { data: currentUser } = await supabase
        .from('users')
        .select('id, name, email')
        .eq('id', req.userId)
        .single();
      
      const { error } = await supabase
        .from('chat_participants')
        .delete()
        .eq('chat_id', spaceChat.chat_id)
        .in('user_id', userIdsToRemove);
      
      if (error) {
        console.error('Error removing members:', error);
        return res.status(500).json({ error: 'Failed to remove members' });
      }
      
      // Send notification message
      if (removedUsers && removedUsers.length > 0 && currentUser) {
        const userName = currentUser.name || currentUser.email;
        const usersList = removedUsers.map(u => u.name || u.email).join(', ');
        const messageText = removedUsers.length === 1
          ? `${userName} eliminó a ${usersList} del proyecto`
          : `${userName} eliminó a ${usersList} del proyecto`;
        
        // Insert system notification message (user_id null = system message)
        await supabase
          .from('chat_messages')
          .insert({
            chat_id: spaceChat.chat_id,
            user_id: null, // null = system message
            message: messageText
          });
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Remove members error:', error);
    res.status(500).json({ error: 'Failed to remove members' });
  }
});

export default router;




