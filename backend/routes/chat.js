import express from 'express';
import supabase from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import webpush from 'web-push';

const router = express.Router();
router.use(authenticate);

// VAPID configuration (required for push notifications)
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidMailto = process.env.VAPID_MAILTO || 'mailto:support@dogeluna.com';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(
    vapidMailto,
    vapidPublicKey,
    vapidPrivateKey
  );
  console.log('✅ VAPID keys configured for push notifications in chat.js');
} else {
  console.warn('⚠️  VAPID keys not configured in chat.js - push notifications will not work');
}

// Helper: Send push notifications to users
async function sendPushNotificationsToUsers(userIds, title, body, data) {
  try {
    // Get all subscriptions for these users
    const { data: subscriptions, error } = await supabase
      .from('push_subscriptions')
      .select('*')
      .in('user_id', userIds);

    if (error) {
      console.error('[PUSH] Error fetching subscriptions:', error);
      return;
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log(`[PUSH] No subscriptions found for ${userIds.length} user(s)`);
      return;
    }

    console.log(`[PUSH] Found ${subscriptions.length} subscription(s) for ${userIds.length} user(s)`);

    // Prepare notification payload
    const payload = JSON.stringify({
      title,
      body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: data || {}
    });

    // Send notifications to all subscriptions
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(sub.subscription, payload);
          console.log(`[PUSH] Notification sent to user ${sub.user_id}`);
          return { success: true, userId: sub.user_id };
        } catch (error) {
          console.error(`[PUSH] Failed to send to user ${sub.user_id}:`, error.message);
          // If subscription is invalid (410 Gone), remove it
          if (error.statusCode === 410) {
            await supabase
              .from('push_subscriptions')
              .delete()
              .eq('id', sub.id);
            console.log(`[PUSH] Removed invalid subscription for user ${sub.user_id}`);
          }
          return { success: false, userId: sub.user_id, error: error.message };
        }
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - successful;
    console.log(`[PUSH] Results: ${successful} sent, ${failed} failed`);
  } catch (error) {
    console.error('[PUSH] Failed to send push notifications:', error);
    console.error('[PUSH] Error stack:', error.stack);
  }
}

// Helper: Send push notifications for system messages
async function sendSystemMessageNotifications(chatId, messageText) {
  try {
    // Get all participants in this chat
    const { data: participants } = await supabase
      .from('chat_participants')
      .select('user_id')
      .eq('chat_id', chatId);
    
    if (!participants || participants.length === 0) {
      console.log(`[SYSTEM NOTIF] No participants found for chat ${chatId}`);
      return;
    }
    
    const recipientIds = participants.map(p => p.user_id);
    console.log(`[SYSTEM NOTIF] Sending to ${recipientIds.length} participant(s) in chat ${chatId}`);
    
    // Truncate message for notification
    const notificationBody = messageText.length > 100 
      ? messageText.substring(0, 100) + '...' 
      : messageText;
    
    // Get space_id for this chat to include in notification data
    const { data: spaceChat } = await supabase
      .from('space_chats')
      .select('space_id')
      .eq('chat_id', chatId)
      .single();
    
    // Send push notification to all participants
    await sendPushNotificationsToUsers(
      recipientIds,
      'System',
      notificationBody,
      {
        type: 'chat_message',
        chatId: chatId,
        spaceId: spaceChat?.space_id || null,
        isSystemMessage: true
      }
    );
    
    console.log(`[SYSTEM NOTIF] Notifications sent successfully for chat ${chatId}`);
  } catch (error) {
    console.error('[SYSTEM NOTIF] Error sending system message notifications:', error);
    console.error('[SYSTEM NOTIF] Error stack:', error.stack);
    // Don't throw - system messages should still be saved even if notifications fail
  }
}

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
  // Get ALL chats for this space to detect duplicates
  const { data: spaceChats } = await supabase
    .from('space_chats')
    .select('chat_id')
    .eq('space_id', spaceId);
  
  if (spaceChats && spaceChats.length > 0) {
    // If there are multiple chats, log a warning and keep only the first one
    // Delete the duplicates
    if (spaceChats.length > 1) {
      console.warn(`[CHAT] WARNING: Space ${spaceId} has ${spaceChats.length} chats! Keeping first chat ${spaceChats[0].chat_id} and removing duplicates.`);
      const duplicateChatIds = spaceChats.slice(1).map(sc => sc.chat_id);
      
      // Delete duplicate space_chats entries
      await supabase
        .from('space_chats')
        .delete()
        .eq('space_id', spaceId)
        .in('chat_id', duplicateChatIds);
      
      console.log(`[CHAT] Removed ${duplicateChatIds.length} duplicate chat(s) for space ${spaceId}`);
    }
    
    const spaceChat = spaceChats[0];
    
    // IMPORTANT: Check if this is a ghost parent before adding user as participant
    // A ghost parent is a space where:
    // 1. User doesn't own it
    // 2. User has access to a child space with this as parent
    // 3. User is NOT a direct participant of this space's chat
    if (space.user_id !== userId) {
      // Check if user has access to any child space with this as parent
      const { data: userChats } = await supabase
        .from('chat_participants')
        .select('chat_id')
        .eq('user_id', userId);
      
      if (userChats && userChats.length > 0) {
        const chatIds = userChats.map(c => c.chat_id);
        const { data: userSpaceChats } = await supabase
          .from('space_chats')
          .select('space_id')
          .in('chat_id', chatIds);
        
        if (userSpaceChats) {
          const accessibleSpaceIds = userSpaceChats.map(sc => sc.space_id);
          const { data: childSpaces } = await supabase
            .from('spaces')
            .select('id')
            .eq('parent_id', spaceId)
            .in('id', accessibleSpaceIds)
            .limit(1);
          
          // If user has access to a child space with this as parent,
          // this is a ghost parent - NEVER add user as participant
          if (childSpaces && childSpaces.length > 0) {
            const { data: existingParticipant } = await supabase
              .from('chat_participants')
              .select('id')
              .eq('chat_id', spaceChat.chat_id)
              .eq('user_id', userId)
              .maybeSingle();
            
            if (!existingParticipant) {
              console.log(`[CHAT] Blocked adding user ${userId} to ghost parent ${space.name} (${spaceId}) - user has access to child space`);
              // Don't add user as participant - this is a ghost parent
              return spaceChat.chat_id; // Return chat_id but don't add as participant
            } else {
              // User is already a participant - this shouldn't happen for ghost parents
              // But if it does, we should remove them (this is a cleanup case)
              console.log(`[CHAT] WARNING: User ${userId} is already participant of ghost parent ${space.name} (${spaceId}) - this should not happen`);
            }
          }
        }
      }
    }
    
    // Chat exists - ensure user is a participant (only if not a ghost parent)
    // Double-check: if user doesn't own space and has access to a child, don't add
    if (space.user_id !== userId) {
      const { data: userChats } = await supabase
        .from('chat_participants')
        .select('chat_id')
        .eq('user_id', userId);
      
      if (userChats && userChats.length > 0) {
        const chatIds = userChats.map(c => c.chat_id);
        const { data: userSpaceChats } = await supabase
          .from('space_chats')
          .select('space_id')
          .in('chat_id', chatIds);
        
        if (userSpaceChats) {
          const accessibleSpaceIds = userSpaceChats.map(sc => sc.space_id);
          const { data: childSpaces } = await supabase
            .from('spaces')
            .select('id')
            .eq('parent_id', spaceId)
            .in('id', accessibleSpaceIds)
            .limit(1);
          
          // If user has access to a child, this is a ghost parent - don't add
          if (childSpaces && childSpaces.length > 0) {
            console.log(`[CHAT] Blocked adding user ${userId} to ghost parent ${space.name} (${spaceId}) - final check`);
            return spaceChat.chat_id; // Return chat_id but don't add as participant
          }
        }
      }
    }
    
    // Only add as participant if user owns the space OR doesn't have access to a child
    const { data: existingParticipant } = await supabase
      .from('chat_participants')
      .select('id')
      .eq('chat_id', spaceChat.chat_id)
      .eq('user_id', userId)
      .maybeSingle();
    
    if (!existingParticipant) {
      await supabase
        .from('chat_participants')
        .insert({ chat_id: spaceChat.chat_id, user_id: userId });
    }
    
    return spaceChat.chat_id;
  }
  
  // For projects with notion_page_id, check if there's already a shared chat
  // For user spaces, check if there's already a shared chat between the two users
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
  } else if (space.category === 'user') {
    // For user spaces: SIMPLE LOGIC
    // 1. Find the other user by name/email
    // 2. Look ONLY in chats associated with USER spaces (category = 'user')
    // 3. Find a chat where BOTH users are participants AND exactly 2 participants total
    // 4. If found, use it. If not, create new.
    
    const { data: otherUser } = await supabase
      .from('users')
      .select('id')
      .or(`email.eq.${space.name},name.eq.${space.name}`)
      .neq('id', userId)
      .maybeSingle();
    
    if (otherUser) {
      // Get ALL chats associated with USER spaces ONLY (not projects)
      const { data: allUserSpaces } = await supabase
        .from('spaces')
        .select('id')
        .eq('category', 'user');
      
      if (allUserSpaces && allUserSpaces.length > 0) {
        const userSpaceIds = allUserSpaces.map(s => s.id);
        
        // Get chats ONLY from user spaces
        const { data: userSpaceChats } = await supabase
          .from('space_chats')
          .select('chat_id')
          .in('space_id', userSpaceIds);
        
        if (userSpaceChats && userSpaceChats.length > 0) {
          const userChatIds = [...new Set(userSpaceChats.map(sc => sc.chat_id))];
          
          // Find chats where BOTH users are participants
          const { data: user1Chats } = await supabase
            .from('chat_participants')
            .select('chat_id')
            .eq('user_id', userId)
            .in('chat_id', userChatIds);
          
          if (user1Chats && user1Chats.length > 0) {
            const user1ChatIds = user1Chats.map(c => c.chat_id);
            
            // Check which chats also have the other user
            const { data: sharedChats } = await supabase
              .from('chat_participants')
              .select('chat_id')
              .in('chat_id', user1ChatIds)
              .eq('user_id', otherUser.id);
            
            if (sharedChats && sharedChats.length > 0) {
              // Verify each chat has EXACTLY 2 participants (one-on-one)
              for (const sharedChat of sharedChats) {
                const { count } = await supabase
                  .from('chat_participants')
                  .select('id', { count: 'exact', head: true })
                  .eq('chat_id', sharedChat.chat_id);
                
                // EXACTLY 2 participants = one-on-one chat
                if (count === 2) {
                  // Verify this chat is ONLY associated with USER spaces (not projects)
                  const { data: chatSpaces } = await supabase
                    .from('space_chats')
                    .select('spaces!inner(category)')
                    .eq('chat_id', sharedChat.chat_id);
                  
                  if (chatSpaces && chatSpaces.length > 0) {
                    // ALL spaces must be user spaces
                    const allAreUserSpaces = chatSpaces.every(sc => sc.spaces.category === 'user');
                    if (allAreUserSpaces) {
                      sharedChatId = sharedChat.chat_id;
                      console.log(`[CHAT] Found one-on-one chat ${sharedChatId} between ${userId} and ${otherUser.id} (only user spaces, exactly 2 participants)`);
                      break;
                    }
                  } else {
                    // Chat not associated with any space - safe to use
                    sharedChatId = sharedChat.chat_id;
                    console.log(`[CHAT] Found one-on-one chat ${sharedChatId} between ${userId} and ${otherUser.id} (no space associations, exactly 2 participants)`);
                    break;
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  
  let chatId;
  if (sharedChatId) {
    // Use the existing shared chat
    chatId = sharedChatId;
    
    // CRITICAL: Verify that the shared chat is NOT associated with a space of different category
    // User spaces should NEVER share chats with project spaces
    const { data: existingSpaceChats } = await supabase
      .from('space_chats')
      .select('space_id, spaces!inner(category)')
      .eq('chat_id', sharedChatId);
    
    if (existingSpaceChats && existingSpaceChats.length > 0) {
      const hasDifferentCategory = existingSpaceChats.some(sc => sc.spaces.category !== space.category);
      if (hasDifferentCategory) {
        console.warn(`[CHAT] WARNING: Shared chat ${sharedChatId} is associated with spaces of different category. Not using it for space ${spaceId} (${space.category}).`);
        sharedChatId = null; // Don't use this chat
        chatId = null; // Will create a new one
      }
    }
    
    if (chatId) {
      // IMPORTANT: Check if this space already has ANY chat (not just this specific chat_id)
      // If it does, we should NOT create a new association - one space should only have one chat
      const { data: existingSpaceChat } = await supabase
        .from('space_chats')
        .select('chat_id')
        .eq('space_id', spaceId)
        .maybeSingle();
      
      if (existingSpaceChat) {
        // Space already has a chat - use that one instead of the shared chat
        console.log(`[CHAT] Space ${spaceId} already has chat ${existingSpaceChat.chat_id}, not using shared chat ${sharedChatId}`);
        chatId = existingSpaceChat.chat_id;
      } else {
        // No chat exists for this space - safe to associate the shared chat
        const { error: insertError } = await supabase
          .from('space_chats')
          .insert({ space_id: spaceId, chat_id: chatId });
        
        if (insertError) {
          // If insert fails (e.g., race condition), get the existing chat
          if (insertError.code === '23505') { // unique_violation
            const { data: existingChat } = await supabase
              .from('space_chats')
              .select('chat_id')
              .eq('space_id', spaceId)
              .maybeSingle();
            
            if (existingChat) {
              chatId = existingChat.chat_id;
            }
          } else {
            console.error('[CHAT] Error inserting shared chat:', insertError);
          }
        }
      }
    }
  }
  
  if (!chatId) {
    // Before creating a new chat, double-check if one was created by another concurrent request
    const { data: doubleCheckSpaceChat } = await supabase
      .from('space_chats')
      .select('chat_id')
      .eq('space_id', spaceId)
      .maybeSingle();
    
    let isNewChat = false;
    
    if (doubleCheckSpaceChat) {
      // Another request created a chat - use it
      chatId = doubleCheckSpaceChat.chat_id;
    } else {
      // Create new chat
      const { data: chat } = await supabase
        .from('chats')
        .insert({})
        .select('id')
        .single();
      
      if (!chat) return null;
      chatId = chat.id;
      isNewChat = true;
      
      // Check one more time before inserting (race condition protection)
      const { data: finalCheckSpaceChat } = await supabase
        .from('space_chats')
        .select('chat_id')
        .eq('space_id', spaceId)
        .maybeSingle();
      
      if (finalCheckSpaceChat) {
        // Another request created a chat while we were creating ours - use theirs
        chatId = finalCheckSpaceChat.chat_id;
        isNewChat = false;
        // Delete the chat we just created (it's not needed)
        await supabase
          .from('chats')
          .delete()
          .eq('id', chat.id);
      } else {
        // Safe to insert - no other request created a chat
        const { error: insertError } = await supabase
          .from('space_chats')
          .insert({ space_id: spaceId, chat_id: chatId });
        
        // If insert fails due to unique constraint, another request got there first
        if (insertError && insertError.code !== '23505') { // 23505 = unique_violation
          console.error('Error inserting space_chat:', insertError);
          return null;
        }
        
        // If unique constraint violation, get the existing chat_id
        if (insertError && insertError.code === '23505') {
          const { data: existingSpaceChat } = await supabase
            .from('space_chats')
            .select('chat_id')
            .eq('space_id', spaceId)
            .maybeSingle();
          
          if (existingSpaceChat) {
            chatId = existingSpaceChat.chat_id;
            isNewChat = false;
            // Delete the chat we just created
            await supabase
              .from('chats')
              .delete()
              .eq('id', chat.id);
          }
        }
      }
    }
    
    // Send system message when a new chat is created
    if (isNewChat) {
      let messageText = '';
      if (space.category === 'project') {
        // Get current user info for message
        const { data: currentUser } = await supabase
          .from('users')
          .select('name, email')
          .eq('id', userId)
          .single();
        
        const userName = currentUser?.name || currentUser?.email || 'Alguien';
        messageText = `${userName} creó el proyecto "${space.name}"`;
      } else if (space.category === 'user') {
        // Get both users info for DM message
        const { data: currentUser } = await supabase
          .from('users')
          .select('name, email')
          .eq('id', userId)
          .single();
        
        const { data: otherUser } = await supabase
          .from('users')
          .select('id, name, email')
          .or(`email.eq.${space.name},name.eq.${space.name}`)
          .neq('id', userId)
          .maybeSingle();
        
        if (otherUser) {
          const userName1 = currentUser?.name || currentUser?.email || 'Alguien';
          const userName2 = otherUser.name || otherUser.email || 'Alguien';
          messageText = `${userName1} y ${userName2} iniciaron una conversación`;
        } else {
          const userName = currentUser?.name || currentUser?.email || 'Alguien';
          messageText = `${userName} inició una conversación`;
        }
      }
      
      if (messageText) {
        await supabase
          .from('chat_messages')
          .insert({
            chat_id: chatId,
            user_id: null, // null = system message
            message: messageText
          });
        
        // Send push notifications for system message (in background)
        setImmediate(async () => {
          await sendSystemMessageNotifications(chatId, messageText);
        });
      }
    }
  }
  
  // IMPORTANT: Check if this is a ghost parent before adding user as participant
  // A ghost parent is a space where user has access to a child but not to the parent itself
  if (space.user_id !== userId) {
    // Check if user has access to any child space with this as parent
    const { data: userChats } = await supabase
      .from('chat_participants')
      .select('chat_id')
      .eq('user_id', userId);
    
    if (userChats && userChats.length > 0) {
      const chatIds = userChats.map(c => c.chat_id);
      const { data: userSpaceChats } = await supabase
        .from('space_chats')
        .select('space_id')
        .in('chat_id', chatIds);
      
      if (userSpaceChats) {
        const accessibleSpaceIds = userSpaceChats.map(sc => sc.space_id);
        const { data: childSpaces } = await supabase
          .from('spaces')
          .select('id')
          .eq('parent_id', spaceId)
          .in('id', accessibleSpaceIds)
          .limit(1);
        
        // If user has access to a child but is NOT a participant of this space's chat,
        // this is a ghost parent - don't add user as participant
        if (childSpaces && childSpaces.length > 0) {
          const { data: existingParticipant } = await supabase
            .from('chat_participants')
            .select('id')
            .eq('chat_id', chatId)
            .eq('user_id', userId)
            .maybeSingle();
          
          if (existingParticipant) {
            // User is already a participant but shouldn't be - remove them
            console.log(`[CHAT] Removing user ${userId} from ghost parent ${space.name} (${spaceId}) - user has access to child but not parent`);
            await supabase
              .from('chat_participants')
              .delete()
              .eq('chat_id', chatId)
              .eq('user_id', userId);
            return chatId; // Return chatId but don't add user as participant
          } else {
            console.log(`[CHAT] Blocked adding user ${userId} to ghost parent ${space.name} (${spaceId}) - user has access to child but not parent`);
            // Don't add user as participant - this is a ghost parent
            return chatId; // Return chatId but don't add user as participant
          }
        }
      }
    }
  }
  
  // Ensure user is a participant (only if not a ghost parent)
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
      // Check current participant count - should only be 1 (the current user) or 2 (both users)
      const { count: participantCount } = await supabase
        .from('chat_participants')
        .select('id', { count: 'exact', head: true })
        .eq('chat_id', chatId);
      
      // Only proceed if we have 1 or 2 participants (one-on-one chat)
      if (participantCount <= 2) {
        // Check if other user is already participant
      const { data: otherParticipant } = await supabase
        .from('chat_participants')
        .select('id')
        .eq('chat_id', chatId)
        .eq('user_id', otherUser.id)
          .maybeSingle();
      
      if (!otherParticipant) {
        await supabase
          .from('chat_participants')
          .insert({ chat_id: chatId, user_id: otherUser.id });
          console.log(`[CHAT] Added user ${otherUser.id} to one-on-one chat ${chatId}`);
        }
      } else {
        // Chat has more than 2 participants - this shouldn't happen for user spaces
        console.warn(`[CHAT] WARNING: User space chat ${chatId} has ${participantCount} participants (expected max 2). This may be a group chat from a project.`);
      }
    }
    
    // NOTE: We don't add space.user_id separately because:
    // 1. For user spaces, space.user_id is the current user (userId) who already added themselves
    // 2. The other user is identified by space.name (email or name), not space.user_id
    // 3. This ensures we only have exactly 2 participants (one-on-one)
  }
  
  return chatId;
}

// Get user's chat IDs (for realtime subscriptions)
router.get('/my-chats', async (req, res) => {
  try {
    const { data: chatParticipants, error } = await supabase
      .from('chat_participants')
      .select('chat_id')
      .eq('user_id', req.userId);
    
    if (error) {
      console.error('Error fetching user chats:', error);
      return res.status(500).json({ error: 'Failed to fetch chats' });
    }
    
    const chatIds = chatParticipants ? chatParticipants.map(p => p.chat_id) : [];
    return res.json({ chatIds });
  } catch (error) {
    console.error('Error in /my-chats:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get space_id for a given chat_id
router.get('/:chatId/space', async (req, res) => {
  try {
    const { chatId } = req.params;
    
    // Find the space associated with this chat
    const { data: spaceChat, error } = await supabase
      .from('space_chats')
      .select('space_id')
      .eq('chat_id', chatId)
      .maybeSingle();
    
    if (error) {
      console.error('Error fetching space for chat:', error);
      return res.status(500).json({ error: 'Failed to fetch space' });
    }
    
    if (!spaceChat) {
      return res.status(404).json({ error: 'Space not found for chat' });
    }
    
    return res.json({ spaceId: spaceChat.space_id });
  } catch (error) {
    console.error('Error in /:chatId/space:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

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

// Get unread message count for a space
router.get('/space/:spaceId/unread-count', async (req, res) => {
  try {
    const { spaceId } = req.params;
    
    // Get or create the chat for this space (if it doesn't exist, create it)
    let chatId = await getOrCreateChatForSpace(spaceId, req.userId);
    
    if (!chatId) {
      return res.json({ unreadCount: 0 });
    }
    
    // Get the last read message ID for this user in this chat
    const { data: readStatus, error: readStatusError } = await supabase
      .from('chat_message_reads')
      .select('last_read_message_id, last_read_at')
      .eq('chat_id', chatId)
      .eq('user_id', req.userId)
      .maybeSingle();
    
    if (readStatusError) {
      console.error('[UNREAD-COUNT] Error fetching read status:', readStatusError);
    }
    
    console.log(`[UNREAD-COUNT] Read status for chat ${chatId}, user ${req.userId}:`, {
      hasReadStatus: !!readStatus,
      lastReadMessageId: readStatus?.last_read_message_id,
      lastReadAt: readStatus?.last_read_at
    });
    
    // Count messages after the last read message
    // Include: messages from other users AND system messages (user_id = null)
    let query = supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('chat_id', chatId)
      .or(`user_id.is.null,user_id.neq.${req.userId}`); // Include system messages (null) and messages from other users
    
    if (readStatus?.last_read_message_id) {
      // Count messages created after the last read message
      const { data: lastReadMessage, error: lastReadMessageError } = await supabase
        .from('chat_messages')
        .select('created_at')
        .eq('id', readStatus.last_read_message_id)
        .maybeSingle();
      
      if (lastReadMessageError) {
        console.error('[UNREAD-COUNT] Error fetching last read message:', lastReadMessageError);
      }
      
      if (lastReadMessage) {
        console.log(`[UNREAD-COUNT] Last read message timestamp: ${lastReadMessage.created_at}`);
        // Count messages created after the last read message (strictly greater than)
        // This ensures we only count messages that arrived AFTER the user last read
        query = query.gt('created_at', lastReadMessage.created_at);
      } else {
      // If last_read_message_id doesn't exist in chat_messages (deleted), count all messages
        console.log(`[UNREAD-COUNT] Last read message ${readStatus.last_read_message_id} not found, counting all messages`);
      }
    } else {
      console.log(`[UNREAD-COUNT] No read status found, counting all messages from other users`);
    }
    // If no read status, count all messages from other users (user has never read)
    
    const { count, error } = await query;
    
    if (error) {
      console.error('[UNREAD-COUNT] Error counting unread messages:', error);
      return res.json({ unreadCount: 0 });
    }
    
    const unreadCount = count || 0;
    console.log(`[UNREAD-COUNT] Unread count for chat ${chatId}, space ${spaceId}: ${unreadCount}`);
    
    res.json({ unreadCount });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// Get total unread message count for user DMs only (not projects)
router.get('/unread-count/users-only', async (req, res) => {
  try {
    // Get all spaces of category "user" (DMs)
    const { data: userSpaces, error: spacesError } = await supabase
      .from('spaces')
      .select('id')
      .eq('category', 'user');

    if (spacesError || !userSpaces || userSpaces.length === 0) {
      return res.json({ unreadCount: 0 });
    }

    const userSpaceIds = userSpaces.map(s => s.id);

    // Get chat_ids for these spaces
    const { data: spaceChats, error: spaceChatsError } = await supabase
      .from('space_chats')
      .select('chat_id, space_id')
      .in('space_id', userSpaceIds);

    if (spaceChatsError || !spaceChats || spaceChats.length === 0) {
      return res.json({ unreadCount: 0 });
    }

    const userDmChatIds = spaceChats.map(sc => sc.chat_id);

    // Filter to only chats where the user is a participant
    const { data: userParticipations, error: participationsError } = await supabase
      .from('chat_participants')
      .select('chat_id')
      .eq('user_id', req.userId)
      .in('chat_id', userDmChatIds);

    if (participationsError || !userParticipations || userParticipations.length === 0) {
      return res.json({ unreadCount: 0 });
    }

    const participantChatIds = userParticipations.map(p => p.chat_id);

    let totalUnread = 0;

    // Get read status for user DM chats
    const { data: readStatuses } = await supabase
      .from('chat_message_reads')
      .select('chat_id, last_read_message_id')
      .eq('user_id', req.userId)
      .in('chat_id', participantChatIds);

    const readStatusMap = new Map();
    if (readStatuses) {
      readStatuses.forEach(rs => {
        readStatusMap.set(rs.chat_id, rs.last_read_message_id);
      });
    }

    // Count unread messages for each DM chat
    for (const chatId of participantChatIds) {
      const lastReadMessageId = readStatusMap.get(chatId);

      // Include: messages from other users AND system messages (user_id = null)
      let query = supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('chat_id', chatId)
        .or(`user_id.is.null,user_id.neq.${req.userId}`);

      if (lastReadMessageId) {
        const { data: lastReadMessage } = await supabase
          .from('chat_messages')
          .select('created_at')
          .eq('id', lastReadMessageId)
          .maybeSingle();

        if (lastReadMessage) {
          query = query.gt('created_at', lastReadMessage.created_at);
        }
      }

      const { count } = await query;
      totalUnread += (count || 0);
    }

    res.json({ unreadCount: totalUnread });
  } catch (error) {
    console.error('Get user DMs unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// Get total unread message count across all user chats
router.get('/unread-count', async (req, res) => {
  try {
    // Get all chats where user is a participant
    const { data: chatParticipants } = await supabase
      .from('chat_participants')
      .select('chat_id')
      .eq('user_id', req.userId);

    if (!chatParticipants || chatParticipants.length === 0) {
      return res.json({ unreadCount: 0 });
    }

    const chatIds = chatParticipants.map(p => p.chat_id);
    let totalUnread = 0;

    // Get read status for all chats
    const { data: readStatuses } = await supabase
      .from('chat_message_reads')
      .select('chat_id, last_read_message_id')
      .eq('user_id', req.userId)
      .in('chat_id', chatIds);

    const readStatusMap = new Map();
    if (readStatuses) {
      readStatuses.forEach(status => {
        readStatusMap.set(status.chat_id, status.last_read_message_id);
      });
    }

    // For each chat, count unread messages
    for (const chatId of chatIds) {
      const lastReadMessageId = readStatusMap.get(chatId);
      
      // Include: messages from other users AND system messages (user_id = null)
      let query = supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('chat_id', chatId)
        .or(`user_id.is.null,user_id.neq.${req.userId}`); // Include system messages (null) and messages from other users

      if (lastReadMessageId) {
        // Get the timestamp of the last read message
        const { data: lastReadMessage } = await supabase
          .from('chat_messages')
          .select('created_at')
          .eq('id', lastReadMessageId)
          .maybeSingle();
        
        if (lastReadMessage) {
          query = query.gt('created_at', lastReadMessage.created_at);
        }
      }
      // If no read status, count all messages from other users

      const { count, error } = await query;
      if (!error && count) {
        totalUnread += count;
      }
    }

    res.json({ unreadCount: totalUnread });
  } catch (error) {
    console.error('Get total unread count error:', error);
    res.status(500).json({ error: 'Failed to get total unread count' });
  }
});

// Get unread counts for all spaces in a single request (optimized)
router.get('/unread-counts/all', async (req, res) => {
  try {
    const userId = req.userId;
    
    // Get all spaces (projects + users) for this user
    const { data: spaces, error: spacesError } = await supabase
      .from('spaces')
      .select('id, category')
      .eq('user_id', userId);
    
    if (spacesError) {
      console.error('[UNREAD-ALL] Error fetching spaces:', spacesError);
      return res.status(500).json({ error: 'Failed to fetch spaces' });
    }
    
    if (!spaces || spaces.length === 0) {
      return res.json({ unreadCounts: {} });
    }
    
    const spaceIds = spaces.map(s => s.id);
    
    // Get all chats for these spaces
    const { data: spaceChats, error: chatsError } = await supabase
      .from('space_chats')
      .select('space_id, chat_id')
      .in('space_id', spaceIds);
    
    if (chatsError) {
      console.error('[UNREAD-ALL] Error fetching chats:', chatsError);
      return res.status(500).json({ error: 'Failed to fetch chats' });
    }
    
    if (!spaceChats || spaceChats.length === 0) {
      return res.json({ unreadCounts: {} });
    }
    
    // Group chats by space_id
    const chatsBySpace = {};
    spaceChats.forEach(sc => {
      if (!chatsBySpace[sc.space_id]) {
        chatsBySpace[sc.space_id] = [];
      }
      chatsBySpace[sc.space_id].push(sc.chat_id);
    });
    
    // Get all read statuses for this user
    const chatIds = [...new Set(spaceChats.map(sc => sc.chat_id))];
    const { data: readStatuses, error: readError } = await supabase
      .from('chat_message_reads')
      .select('chat_id, last_read_message_id, last_read_at')
      .eq('user_id', userId)
      .in('chat_id', chatIds);
    
    if (readError) {
      console.error('[UNREAD-ALL] Error fetching read statuses:', readError);
      return res.status(500).json({ error: 'Failed to fetch read statuses' });
    }
    
    // Create map of chat_id -> last_read_message_id
    const readStatusMap = new Map();
    if (readStatuses) {
      for (const status of readStatuses) {
        readStatusMap.set(status.chat_id, status.last_read_message_id);
      }
    }
    
    // Get last_read timestamps for all chats
    const lastReadMessageIds = Array.from(readStatusMap.values()).filter(Boolean);
    let lastReadTimestamps = new Map();
    
    if (lastReadMessageIds.length > 0) {
      const { data: lastReadMessages, error: lastReadMessagesError } = await supabase
        .from('chat_messages')
        .select('id, created_at')
        .in('id', lastReadMessageIds);
      
      if (lastReadMessagesError) {
        console.error('[UNREAD-ALL] Error fetching last read messages:', lastReadMessagesError);
      }
      
      if (lastReadMessages) {
        lastReadMessages.forEach(msg => {
          lastReadTimestamps.set(msg.id, msg.created_at);
        });
        console.log(`[UNREAD-ALL] Found ${lastReadMessages.length} last read messages out of ${lastReadMessageIds.length} requested`);
      } else {
        console.log(`[UNREAD-ALL] No last read messages found for ${lastReadMessageIds.length} message IDs`);
      }
    }
    
    // Count unread messages for each chat
    const unreadCounts = {};
    
    // Process all chats in batches
    const batchSize = 50;
    for (let i = 0; i < chatIds.length; i += batchSize) {
      const batch = chatIds.slice(i, i + batchSize);
      
      // Get counts for this batch
      const countPromises = batch.map(async (chatId) => {
        const lastReadId = readStatusMap.get(chatId);
        let query = supabase
          .from('chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('chat_id', chatId)
          .or(`user_id.is.null,user_id.neq.${userId}`);
        
        if (lastReadId) {
          const lastReadTime = lastReadTimestamps.get(lastReadId);
          if (lastReadTime) {
            query = query.gt('created_at', lastReadTime);
          } else {
            console.log(`[UNREAD-ALL] Warning: last_read_message_id ${lastReadId} not found in lastReadTimestamps map`);
          }
        } else {
          // No read status - count ALL messages from others/system (this is correct behavior)
          console.log(`[UNREAD-ALL] Chat ${chatId} has no read status - counting all messages from others/system`);
        }
        
        const { count, error: countError } = await query;
        if (countError) {
          console.error(`[UNREAD-ALL] Error counting unread for chat ${chatId}:`, countError);
        }
        const unreadCount = count || 0;
        if (unreadCount > 0) {
          console.log(`[UNREAD-ALL] Chat ${chatId} has ${unreadCount} unread messages (lastReadId: ${lastReadId || 'none'}, lastReadTime: ${lastReadId ? (lastReadTimestamps.get(lastReadId) || 'N/A') : 'N/A'})`);
        }
        return { chatId, count: unreadCount };
      });
      
      const results = await Promise.allSettled(countPromises);
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          const { chatId, count } = result.value;
          // Find which space(s) this chat belongs to
          spaceChats
            .filter(sc => sc.chat_id === chatId)
            .forEach(sc => {
              if (!unreadCounts[sc.space_id]) {
                unreadCounts[sc.space_id] = 0;
              }
              unreadCounts[sc.space_id] += count;
              if (count > 0) {
                console.log(`[UNREAD-ALL] Chat ${chatId} has ${count} unread messages, adding to space ${sc.space_id}`);
              }
            });
        } else {
          console.error(`[UNREAD-ALL] Error counting unread for chat:`, result.reason);
        }
      });
    }
    
    // Filter out spaces with 0 unread count (only return spaces with actual unread messages)
    const filteredUnreadCounts = {};
    Object.entries(unreadCounts).forEach(([spaceId, count]) => {
      if (count > 0) {
        filteredUnreadCounts[spaceId] = count;
        console.log(`[UNREAD-ALL] Space ${spaceId} has ${count} unread messages`);
      }
    });
    
    console.log(`[UNREAD-ALL] Returning ${Object.keys(filteredUnreadCounts).length} spaces with unread messages out of ${Object.keys(unreadCounts).length} total spaces checked`);
    res.json({ unreadCounts: filteredUnreadCounts });
  } catch (error) {
    console.error('[UNREAD-ALL] Error:', error);
    res.status(500).json({ error: 'Failed to get unread counts' });
  }
});

// Mark messages as read for a space
router.post('/space/:spaceId/mark-read', async (req, res) => {
  try {
    const { spaceId } = req.params;
    
    console.log(`[MARK-READ] Marking messages as read for space ${spaceId}, user ${req.userId}`);
    
    // Get or create the chat for this space (if it doesn't exist, create it)
    let chatId = await getOrCreateChatForSpace(spaceId, req.userId);
    
    if (!chatId) {
      console.error('[MARK-READ] Failed to get or create chat for space:', spaceId);
      return res.status(404).json({ error: 'Chat not found for this space' });
    }
    
    console.log(`[MARK-READ] Using chat ${chatId} for space ${spaceId}`);
    
    // Check if there are multiple chats for this space (shouldn't happen, but log if it does)
    const { data: allSpaceChats } = await supabase
      .from('space_chats')
      .select('chat_id')
      .eq('space_id', spaceId);
    
    if (allSpaceChats && allSpaceChats.length > 1) {
      console.warn(`[MARK-READ] WARNING: Space ${spaceId} has ${allSpaceChats.length} chats associated! This should not happen. Chats:`, allSpaceChats.map(sc => sc.chat_id));
    }
    
    // Get the most recent message in this chat
    const { data: latestMessage } = await supabase
      .from('chat_messages')
      .select('id, created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (!latestMessage) {
      console.log(`[MARK-READ] No messages in chat ${chatId}, marking as read with null`);
      // No messages yet, just create/update read status with null
      const { error: upsertError } = await supabase
        .from('chat_message_reads')
        .upsert({
          chat_id: chatId,
          user_id: req.userId,
          last_read_message_id: null,
          last_read_at: new Date().toISOString()
        }, {
          onConflict: 'chat_id,user_id'
        });
      
      if (upsertError) {
        console.error('[MARK-READ] Error marking as read:', upsertError);
        console.error('[MARK-READ] Error details:', JSON.stringify(upsertError, null, 2));
        return res.status(500).json({ 
          error: 'Failed to mark as read',
          details: upsertError.message || 'Unknown error',
          code: upsertError.code
        });
      }
      
      console.log(`[MARK-READ] Successfully marked as read (no messages)`);
      return res.json({ success: true });
    }
    
    console.log(`[MARK-READ] Latest message: ${latestMessage.id}, created_at: ${latestMessage.created_at}`);
    
    // Upsert the read status - use the latest message's timestamp to ensure we mark ALL messages up to this point as read
    // Use onConflict to specify which columns to check for conflicts
      const { error: upsertError } = await supabase
        .from('chat_message_reads')
        .upsert({
          chat_id: chatId,
          user_id: req.userId,
          last_read_message_id: latestMessage.id,
        last_read_at: latestMessage.created_at // Use message timestamp, not current time
        }, {
          onConflict: 'chat_id,user_id'
        });
    
    if (upsertError) {
      console.error('[MARK-READ] Error marking as read:', upsertError);
      console.error('[MARK-READ] Error details:', JSON.stringify(upsertError, null, 2));
      return res.status(500).json({ 
        error: 'Failed to mark as read',
        details: upsertError.message || 'Unknown error',
        code: upsertError.code
      });
    }
    
    console.log(`[MARK-READ] Successfully marked messages as read for chat ${chatId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[MARK-READ] Mark as read error:', error);
    console.error('[MARK-READ] Error stack:', error.stack);
    console.error('[MARK-READ] Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    res.status(500).json({ 
      error: 'Failed to mark as read',
      details: error.message || 'Unknown error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
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
        user:users!chat_messages_user_id_fkey(id, name, email, avatar_photo)
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
    
    // Note: We don't mark messages as read here because:
    // 1. The mark-read endpoint handles this when the chat is opened
    // 2. This endpoint may only load a subset of messages (pagination)
    // 3. We want to mark ALL messages as read, not just the loaded ones
    
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
        user:users!chat_messages_user_id_fkey(id, name, email, avatar_photo)
      `)
      .single();
    
    if (error) {
      console.error('Error sending message:', error);
      return res.status(500).json({ error: 'Failed to send message' });
    }
    
    // Send push notifications to other participants (in background)
    setImmediate(async () => {
      try {
        // Get all other participants in this chat
        const { data: participants } = await supabase
          .from('chat_participants')
          .select('user_id, users!chat_participants_user_id_fkey(id, name, email)')
          .eq('chat_id', chatId)
          .neq('user_id', req.userId);
        
        if (!participants || participants.length === 0) {
          return;
        }
        
        const recipientIds = participants.map(p => p.user_id);
        
        // Get sender name
        const senderName = newMessage.user?.name || newMessage.user?.email || 'Someone';
        const displayName = senderName.includes('@') ? senderName.split('@')[0] : senderName;
        
        // Truncate message for notification
        const messageText = message.trim();
        const notificationBody = messageText.length > 100 ? messageText.substring(0, 100) + '...' : messageText;
        
        // Send push notification to all recipients
        await sendPushNotificationsToUsers(
          recipientIds,
          displayName,
          notificationBody,
          {
            type: 'chat_message',
            chatId: chatId,
            messageId: newMessage.id,
            senderId: req.userId
          }
        );
      } catch (pushError) {
        console.error('Error sending push notifications:', pushError);
        // Don't fail the request if push fails
      }
    });
    
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
      
      // Send push notifications for system message (in background)
      setImmediate(async () => {
        await sendSystemMessageNotifications(chatId, messageText);
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
        
        // Send push notifications for system message (in background)
        setImmediate(async () => {
          await sendSystemMessageNotifications(spaceChat.chat_id, messageText);
        });
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Remove members error:', error);
    res.status(500).json({ error: 'Failed to remove members' });
  }
});

// Test endpoint: Send a test system message notification
router.post('/test/system-message', authenticate, async (req, res) => {
  try {
    const { chatId, message } = req.body;
    
    if (!chatId) {
      return res.status(400).json({ error: 'chatId is required' });
    }
    
    // Verify user has access to this chat
    const { data: participant } = await supabase
      .from('chat_participants')
      .select('id')
      .eq('chat_id', chatId)
      .eq('user_id', req.userId)
      .single();
    
    if (!participant) {
      return res.status(403).json({ error: 'Access denied to this chat' });
    }
    
    // Create test system message
    const testMessage = message || `🧪 Test system message - ${new Date().toLocaleString()}`;
    
    // Insert system message
    const { data: newMessage, error: insertError } = await supabase
      .from('chat_messages')
      .insert({
        chat_id: chatId,
        user_id: null, // null = system message
        message: testMessage
      })
      .select('id, chat_id, message, created_at')
      .single();
    
    if (insertError) {
      console.error('Error inserting test system message:', insertError);
      return res.status(500).json({ error: 'Failed to insert test message' });
    }
    
    // Send push notifications for system message (in background)
    setImmediate(async () => {
      await sendSystemMessageNotifications(chatId, testMessage);
    });
    
    res.json({ 
      success: true, 
      message: 'Test system message sent',
      data: {
        messageId: newMessage.id,
        chatId: newMessage.chat_id,
        message: newMessage.message,
        createdAt: newMessage.created_at,
        notificationSent: true
      }
    });
  } catch (error) {
    console.error('Test system message error:', error);
    res.status(500).json({ error: 'Failed to send test system message' });
  }
});

export default router;
export { getOrCreateChatForSpace, sendSystemMessageNotifications };




