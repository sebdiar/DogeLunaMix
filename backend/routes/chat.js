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
    .select('id, category, name, user_id')
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
    // Chat exists - ensure current user is a participant
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
  
  // Create new chat
  const { data: chat } = await supabase
    .from('chats')
    .insert({})
    .select('id')
    .single();
  
  if (!chat) return null;
  
  await supabase
    .from('space_chats')
    .insert({ space_id: spaceId, chat_id: chat.id });
  
  // Add current user as participant
  await supabase
    .from('chat_participants')
    .insert({ chat_id: chat.id, user_id: userId });
  
  // If this is a user space (DM), add the other user as participant too
  if (space.category === 'user') {
    // Find the other user by name/email
    const { data: otherUser } = await supabase
      .from('users')
      .select('id')
      .or(`email.eq.${space.name},name.eq.${space.name}`)
      .neq('id', userId)
      .single();
    
    if (otherUser) {
      // Add the other user as participant
      await supabase
        .from('chat_participants')
        .insert({ chat_id: chat.id, user_id: otherUser.id });
    }
    
    // Also add the space owner if different from current user
    if (space.user_id && space.user_id !== userId) {
      const { data: ownerParticipant } = await supabase
        .from('chat_participants')
        .select('id')
        .eq('chat_id', chat.id)
        .eq('user_id', space.user_id)
        .single();
      
      if (!ownerParticipant) {
        await supabase
          .from('chat_participants')
          .insert({ chat_id: chat.id, user_id: space.user_id });
      }
    }
  }
  
  return chat.id;
}

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
    
    // Ensure current user is a participant (should already be added by getOrCreateChatForSpace, but double-check)
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

export default router;




