import express from 'express';
import supabase from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { createNotionPage, updateNotionPageName, archiveNotionPage, updateNotionPageParent, updateNotionPageTags, addNotionPageParent, removeNotionPageParent } from '../services/notion.js';

const router = express.Router();
router.use(authenticate);

// Get spaces by category
router.get('/', async (req, res) => {
  try {
    const { category } = req.query;
    
    console.log(`[SPACES] GET /api/spaces?category=${category} for userId=${req.userId}`);
    
    // For projects, get both:
    // 1. Projects owned by the user
    // 2. Projects where the user is a member (participant in the chat)
    // For user spaces, get both:
    // 1. User spaces owned by the user
    // 2. User spaces where the user is a participant in the chat (shared DMs)
    let query = supabase
      .from('spaces')
      .select('*')
      .eq('user_id', req.userId);
    
    if (category) {
      query = query.eq('category', category);
    }
    
    // Handle archived filter: 'true' = only archived, 'false' = only active, undefined/'all' = all
    const { archived } = req.query;
    if (archived === 'true') {
      query = query.eq('archived', true);
    } else if (archived === 'false') {
      query = query.eq('archived', false);
    }
    // If archived is undefined or 'all', return all (both archived and active)
    
    const { data: spacesData, error } = await query
      .order('position', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    
    if (error) {
      console.error('[SPACES] Error fetching spaces:', error);
      return res.status(500).json({ error: 'Failed to fetch spaces' });
    }
    
    let spaces = spacesData || [];
    console.log(`[SPACES] Found ${spaces.length} spaces owned by user (category=${category})`);
    
    // For projects and user spaces, also include spaces where user is a member (but not owner)
    if (category === 'project' || category === 'user' || !category) {
      // Get all chats where the user is a participant
      const { data: userChats } = await supabase
        .from('chat_participants')
        .select('chat_id')
        .eq('user_id', req.userId);
      
      console.log(`[SPACES] User ${req.userId} is participant in ${userChats?.length || 0} chats, category=${category}`);
      
      if (userChats && userChats.length > 0) {
        const chatIds = userChats.map(c => c.chat_id);
        
        // Get spaces linked to these chats
        const { data: spaceChats } = await supabase
          .from('space_chats')
          .select('space_id, chat_id')
          .in('chat_id', chatIds);
        
        console.log(`[SPACES] Found ${spaceChats?.length || 0} space_chats linked to user's chats`);
        
        if (spaceChats && spaceChats.length > 0) {
          const spaceIds = spaceChats.map(sc => sc.space_id);
          
          // Get these spaces (projects or user spaces, not owned by current user, not archived)
          let memberSpacesQuery = supabase
            .from('spaces')
            .select('*')
            .in('id', spaceIds)
            .neq('user_id', req.userId); // Exclude spaces owned by user (already included above)
          
          // Filter by category if specified
          if (category) {
            memberSpacesQuery = memberSpacesQuery.eq('category', category);
          }
          
          // Apply same archived filter for member spaces
          if (archived === 'true') {
            memberSpacesQuery = memberSpacesQuery.eq('archived', true);
          } else if (archived === 'false') {
            memberSpacesQuery = memberSpacesQuery.eq('archived', false);
          }
          // If archived is undefined or 'all', return all (both archived and active)
          
          const { data: memberSpaces, error: memberSpacesError } = await memberSpacesQuery
            .order('position', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: true });
          
          if (memberSpacesError) {
            console.error(`[SPACES] Error fetching member spaces for category=${category}:`, memberSpacesError);
          }
          
          if (!memberSpacesError && memberSpaces) {
            console.log(`[SPACES] Found ${memberSpaces.length} member spaces for category=${category}, userId=${req.userId}`);
            
            // Add member spaces to the list, avoiding duplicates
            const existingIds = new Set(spaces.map(s => s.id));
            
            // Collect parent IDs from child spaces that user has access to
            // We need to recursively fetch all parents in the chain, not just the immediate parent
            const parentIdsToInclude = new Set();
            
            memberSpaces.forEach(s => {
              if (!existingIds.has(s.id)) {
                console.log(`[SPACES] Adding shared space: ${s.name} (id: ${s.id}, category: ${s.category}, parent_id: ${s.parent_id || 'none'})`);
                spaces.push(s);
                existingIds.add(s.id);
              }
              // If this is a child space (has parent_id), add it to the set to fetch
              if (s.parent_id && !existingIds.has(s.parent_id)) {
                parentIdsToInclude.add(s.parent_id);
                console.log(`[SPACES] Will include ghost parent: ${s.parent_id} for child space: ${s.name}`);
              }
            });
            
            // Fetch parent spaces and mark them as ghost (read-only, visible but not clickable)
            // IMPORTANT: Only include ghost parents if they match the requested category
            // We need to recursively fetch all parents in the chain
            if (parentIdsToInclude.size > 0) {
              // We need to fetch all parents and then recursively fetch their parents too
              let allParentIds = new Set(parentIdsToInclude);
              let fetchedParents = new Map();
              
              // Keep fetching parents until we have all of them in the chain
              let hasMoreParents = true;
              let iteration = 0;
              const maxIterations = 10; // Safety limit to prevent infinite loops
              
              while (hasMoreParents && iteration < maxIterations) {
                iteration++;
                hasMoreParents = false;
                
                // Fetch all parents we haven't fetched yet
                const idsToFetch = Array.from(allParentIds).filter(id => !fetchedParents.has(id));
                
                if (idsToFetch.length === 0) {
                  break; // No more parents to fetch
                }
                
                let parentSpacesQuery = supabase
                  .from('spaces')
                  .select('*')
                  .in('id', idsToFetch);
                
                // Filter ghost parents by category to ensure projects don't appear in users section
                if (category) {
                  parentSpacesQuery = parentSpacesQuery.eq('category', category);
                }
                
                const { data: parentSpaces, error: parentError } = await parentSpacesQuery;
                
                if (!parentError && parentSpaces) {
                  console.log(`[SPACES] Found ${parentSpaces.length} ghost parents to include (iteration ${iteration})`);
                  
                  // Check if any of these parents have their own parents
                  parentSpaces.forEach(parent => {
                    fetchedParents.set(parent.id, parent);
                    // If this parent has a parent_id and we haven't fetched it yet, add it to the set
                    if (parent.parent_id && !allParentIds.has(parent.parent_id) && !existingIds.has(parent.parent_id)) {
                      allParentIds.add(parent.parent_id);
                      hasMoreParents = true;
                      console.log(`[SPACES] Found parent of parent: ${parent.parent_id} for ${parent.name}`);
                    }
                  });
                } else {
                  break; // Error or no more parents
                }
              }
              
              // Now add all fetched parents as ghost parents
              fetchedParents.forEach(parent => {
                // Mark as ghost - visible but not accessible
                parent.isGhost = true;
                parent.isReadOnly = true;
                // Double-check category matches before adding
                if (!category || parent.category === category) {
                  if (!existingIds.has(parent.id)) {
                    console.log(`[SPACES] Adding ghost parent: ${parent.name} (id: ${parent.id}, category: ${parent.category}, parent_id: ${parent.parent_id || 'none'})`);
                    spaces.push(parent);
                    existingIds.add(parent.id);
                  }
                }
              });
            }
          }
        }
      }
    }
    
    // For user spaces (DMs), enrich with other user's info
    if (category === 'user') {
      const { data: currentUser } = await supabase
        .from('users')
        .select('email, name, avatar_photo')
        .eq('id', req.userId)
        .single();
      
      // OPTIMIZATION: Batch load all data upfront instead of individual queries in loops
      // 1. Get all space_chats for all spaces in one query
      const allSpaceIds = spaces.map(s => s.id);
      const { data: allSpaceChats } = allSpaceIds.length > 0 ? await supabase
        .from('space_chats')
        .select('space_id, chat_id')
        .in('space_id', allSpaceIds) : { data: [] };
      
      // Create map: space_id -> chat_id
      const spaceChatMap = new Map();
      if (allSpaceChats) {
        allSpaceChats.forEach(sc => {
          spaceChatMap.set(sc.space_id, sc.chat_id);
        });
      }
      
      // 2. Get all chat participants for all chats in one query
      const allChatIds = Array.from(spaceChatMap.values());
      const { data: allParticipants } = allChatIds.length > 0 ? await supabase
        .from('chat_participants')
        .select('chat_id, user_id, users!chat_participants_user_id_fkey(id, name, email, avatar_photo)')
        .in('chat_id', allChatIds) : { data: [] };
      
      // Create map: chat_id -> participants[]
      const chatParticipantsMap = new Map();
      if (allParticipants) {
        allParticipants.forEach(p => {
          if (!chatParticipantsMap.has(p.chat_id)) {
            chatParticipantsMap.set(p.chat_id, []);
          }
          chatParticipantsMap.get(p.chat_id).push(p);
        });
      }
      
      // 3. Collect all unique email/name values from spaces that need user lookup
      const userLookupKeys = new Set();
      spaces.forEach(space => {
        const chatId = spaceChatMap.get(space.id);
        if (!chatId && space.name) {
          // No chat yet - need to lookup by name/email
          userLookupKeys.add(space.name);
        }
      });
      
      // 4. Batch lookup users by email/name in one query
      const userLookupMap = new Map(); // email/name -> user
      if (userLookupKeys.size > 0) {
        const lookupKeysArray = Array.from(userLookupKeys);
        // Build OR conditions for all lookup keys
        const orConditions = lookupKeysArray.flatMap(key => [
          `email.eq.${key}`,
          `name.eq.${key}`
        ]);
        
        const { data: foundUsers } = await supabase
          .from('users')
          .select('id, name, email, avatar_photo')
          .or(orConditions.join(','))
          .neq('id', req.userId);
        
        if (foundUsers) {
          foundUsers.forEach(user => {
            // Map by both email and name for easy lookup
            if (user.email) userLookupMap.set(user.email, user);
            if (user.name) userLookupMap.set(user.name, user);
          });
        }
      }
      
      // 5. Now enrich spaces using the pre-loaded data (no more queries in loop)
      for (let space of spaces) {
        const chatId = spaceChatMap.get(space.id);
        
        if (chatId) {
          // Has chat - get participants from map
          const participants = chatParticipantsMap.get(chatId) || [];
          
          if (participants.length > 0) {
            // Only support DMs (2 participants) - no groups
            if (participants.length === 2) {
              // This is a DM (2 participants: current user + one other)
              const otherParticipant = participants.find(p => p.user_id !== req.userId && p.users);
              
              if (otherParticipant && otherParticipant.users) {
                // Show the other user's name and photo
                space.display_name = otherParticipant.users.name || otherParticipant.users.email;
                space.other_user_id = otherParticipant.users.id;
                space.other_user_photo = otherParticipant.users.avatar_photo;
              } else {
                // Fallback to space name
                space.display_name = space.name;
              }
            } else if (participants.length === 1 && participants[0].user_id === req.userId) {
              // This is a personal notes chat (only current user)
              space.display_name = space.name;
              space.is_personal_notes = true;
              space.other_user_photo = currentUser?.avatar_photo || null; // Use current user's photo
            } else {
              // Fallback to space name
              space.display_name = space.name;
            }
          } else {
            // No participants - fallback to space name
            space.display_name = space.name;
          }
        } else {
          // No chat yet - try to find by name/email from lookup map
          if (space.name) {
            const otherUser = userLookupMap.get(space.name);
            
            if (otherUser) {
              space.display_name = otherUser.name || otherUser.email;
              space.other_user_id = otherUser.id;
              space.other_user_photo = otherUser.avatar_photo;
            } else {
              space.display_name = space.name;
            }
          } else {
            space.display_name = space.name;
          }
        }
      }
      
      // Also get spaces where current user is a participant in the chat
      // This includes spaces owned by other users where current user is in the chat
      if (currentUser) {
        // Find all chats where current user is a participant
        const { data: userChats } = await supabase
          .from('chat_participants')
          .select('chat_id')
          .eq('user_id', req.userId);
        
        if (userChats && userChats.length > 0) {
          const chatIds = userChats.map(c => c.chat_id);
          
          // Find spaces linked to these chats
          const { data: spaceChats } = await supabase
            .from('space_chats')
            .select('space_id, chat_id')
            .in('chat_id', chatIds);
          
          if (spaceChats && spaceChats.length > 0) {
            const spaceIds = spaceChats.map(sc => sc.space_id);
            
            // Get these spaces - don't filter by archived for shared spaces
            // Shared spaces should always be visible to participants
            const { data: sharedSpaces } = await supabase
              .from('spaces')
              .select('*, owner:users!spaces_user_id_fkey(id, name, email, avatar_photo)')
              .in('id', spaceIds)
              .eq('category', 'user');
            
            if (sharedSpaces && sharedSpaces.length > 0) {
              // OPTIMIZATION: Batch load data for shared spaces
              const sharedSpaceIds = sharedSpaces.map(s => s.id);
              
              // Get all space_chats for shared spaces
              const { data: sharedSpaceChats } = await supabase
                .from('space_chats')
                .select('space_id, chat_id')
                .in('space_id', sharedSpaceIds);
              
              // Update spaceChatMap with shared spaces
              if (sharedSpaceChats) {
                sharedSpaceChats.forEach(sc => {
                  spaceChatMap.set(sc.space_id, sc.chat_id);
                });
              }
              
              // Get chat IDs for shared spaces
              const sharedChatIds = sharedSpaceChats ? sharedSpaceChats.map(sc => sc.chat_id) : [];
              
              // Get participants for shared chats (if not already loaded)
              const newChatIds = sharedChatIds.filter(cid => !chatParticipantsMap.has(cid));
              if (newChatIds.length > 0) {
                const { data: sharedParticipants } = await supabase
                  .from('chat_participants')
                  .select('chat_id, user_id, users!chat_participants_user_id_fkey(id, name, email, avatar_photo)')
                  .in('chat_id', newChatIds);
                
                if (sharedParticipants) {
                  sharedParticipants.forEach(p => {
                    if (!chatParticipantsMap.has(p.chat_id)) {
                      chatParticipantsMap.set(p.chat_id, []);
                    }
                    chatParticipantsMap.get(p.chat_id).push(p);
                  });
                }
              }
              
              // Collect lookup keys for shared spaces
              sharedSpaces.forEach(space => {
                const chatId = spaceChatMap.get(space.id);
                if (!chatId && space.name) {
                  userLookupKeys.add(space.name);
                }
              });
              
              // Batch lookup users for shared spaces (if needed)
              if (userLookupKeys.size > 0) {
                const lookupKeysArray = Array.from(userLookupKeys);
                const orConditions = lookupKeysArray.flatMap(key => [
                  `email.eq.${key}`,
                  `name.eq.${key}`
                ]);
                
                const { data: foundUsers } = await supabase
                  .from('users')
                  .select('id, name, email, avatar_photo')
                  .or(orConditions.join(','))
                  .neq('id', req.userId);
                
                if (foundUsers) {
                  foundUsers.forEach(user => {
                    if (user.email) userLookupMap.set(user.email, user);
                    if (user.name) userLookupMap.set(user.name, user);
                  });
                }
              }
              
              // Enrich shared spaces using pre-loaded data
              for (let space of sharedSpaces) {
                // For spaces owned by other users, the "other user" is the owner
                if (space.user_id !== req.userId) {
                  space.display_name = space.owner?.name || space.owner?.email || space.name;
                  space.other_user_id = space.user_id;
                  space.other_user_photo = space.owner?.avatar_photo;
                } else {
                  const chatId = spaceChatMap.get(space.id);
                  
                  if (chatId) {
                    // Has chat - get participants from map
                    const participants = chatParticipantsMap.get(chatId) || [];
                    
                    if (participants.length > 0) {
                      // Only support DMs (2 participants) - no groups
                      if (participants.length === 2) {
                        // This is a DM (2 participants)
                        const otherParticipant = participants.find(p => p.user_id !== req.userId && p.users);
                        
                        if (otherParticipant && otherParticipant.users) {
                          space.display_name = otherParticipant.users.name || otherParticipant.users.email;
                          space.other_user_id = otherParticipant.users.id;
                          space.other_user_photo = otherParticipant.users.avatar_photo;
                        } else {
                          space.display_name = space.name;
                        }
                      } else {
                        space.display_name = space.name;
                      }
                    } else {
                      space.display_name = space.name;
                    }
                  } else if (space.name) {
                    // No chat yet - try to find by name/email from lookup map
                    const otherUser = userLookupMap.get(space.name);
                    
                    if (otherUser) {
                      space.display_name = otherUser.name || otherUser.email;
                      space.other_user_id = otherUser.id;
                      space.other_user_photo = otherUser.avatar_photo;
                    } else {
                      space.display_name = space.name;
                    }
                  } else {
                    space.display_name = space.name;
                  }
                }
              }
              
              // Add shared spaces to the list, avoiding duplicates
              // Also check for duplicate chats (same chat_id) to avoid showing the same chat twice
              const existingIds = new Set(spaces.map(s => s.id));
              const existingChatIds = new Map(); // Map chat_id -> space_id to track which space represents each chat
              
              // Use pre-loaded spaceChatMap instead of querying again
              for (const space of spaces) {
                const chatId = spaceChatMap.get(space.id);
                if (chatId) {
                  existingChatIds.set(chatId, space.id);
                }
              }
              
              // Only add shared spaces that don't duplicate existing chats
              for (const s of sharedSpaces) {
                if (!existingIds.has(s.id)) {
                  // Check if this space's chat is already represented (using pre-loaded map)
                  const chatId = spaceChatMap.get(s.id);
                  
                  if (chatId) {
                    const existingSpaceId = existingChatIds.get(chatId);
                    if (existingSpaceId) {
                      // This chat is already represented by another space
                      // Prefer the space owned by the current user if available
                      const existingSpace = spaces.find(sp => sp.id === existingSpaceId);
                      if (existingSpace && existingSpace.user_id === req.userId) {
                        // Keep the existing space (owned by current user) - skip this one
                        continue;
                      } else if (s.user_id === req.userId) {
                        // Replace with the current user's space
                        const index = spaces.findIndex(sp => sp.id === existingSpaceId);
                        if (index !== -1) {
                          spaces[index] = s;
                          existingIds.delete(existingSpaceId);
                          existingIds.add(s.id);
                          existingChatIds.set(chatId, s.id);
                        }
                        continue;
                      } else {
                        // Keep the existing one - skip this one
                        continue;
                      }
                    }
                    existingChatIds.set(chatId, s.id);
                  }
                  
                  spaces.push(s);
                  existingIds.add(s.id);
                }
              }
            }
          }
        }
        
        // Also get spaces by name match (backward compatibility)
        // Don't filter by archived - shared spaces should always be visible
        const { data: sharedSpacesByName } = await supabase
          .from('spaces')
          .select('*, owner:users!spaces_user_id_fkey(id, name, email, avatar_photo)')
          .eq('category', 'user')
          .neq('user_id', req.userId)
          .or(`name.eq.${currentUser.email},name.eq.${currentUser.name}`);
        
        if (sharedSpacesByName && sharedSpacesByName.length > 0) {
          const mappedShared = sharedSpacesByName.map(s => ({
            ...s,
            other_user_photo: s.owner?.avatar_photo,
            display_name: s.owner?.name || s.owner?.email || s.name
          }));
          
          const existingIds = new Set(spaces.map(s => s.id));
          mappedShared.forEach(s => {
            if (!existingIds.has(s.id)) {
              spaces.push(s);
            }
          });
        }
      }
    }
    
    // Final deduplication: remove spaces that share the same chat_id
    // Keep only one space per chat_id (prefer spaces owned by current user)
    if (category === 'user' && spaces.length > 0) {
      const chatIdToSpace = new Map();
      const spacesToKeep = [];
      
      // First pass: collect all spaces with their chat_ids
      for (const space of spaces) {
        const { data: spaceChat } = await supabase
          .from('space_chats')
          .select('chat_id')
          .eq('space_id', space.id)
          .maybeSingle();
        
        if (spaceChat) {
          const existingSpace = chatIdToSpace.get(spaceChat.chat_id);
          if (!existingSpace) {
            chatIdToSpace.set(spaceChat.chat_id, space);
            spacesToKeep.push(space);
          } else {
            // Prefer space owned by current user
            if (space.user_id === req.userId && existingSpace.user_id !== req.userId) {
              // Replace with current user's space
              const index = spacesToKeep.findIndex(s => s.id === existingSpace.id);
              if (index !== -1) {
                spacesToKeep[index] = space;
                chatIdToSpace.set(spaceChat.chat_id, space);
              }
            }
            // Otherwise keep the existing one
          }
        } else {
          // Space without chat - keep it (might be a personal notes space)
          spacesToKeep.push(space);
        }
      }
      
      spaces = spacesToKeep;
    }
    
    res.json({ spaces: spaces || [] });
  } catch (error) {
    console.error('Get spaces error:', error);
    res.status(500).json({ error: 'Failed to get spaces' });
  }
});

// Get single space with tabs
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: space, error: spaceError } = await supabase
      .from('spaces')
      .select('*')
      .eq('id', id)
      .single();
    
    if (spaceError || !space) {
      return res.status(404).json({ error: 'Space not found' });
    }
    
    let hasAccess = space.user_id === req.userId;
    
    // For projects, check if user is a member (participant in the chat)
    if (!hasAccess && space.category === 'project') {
      const { data: spaceChat } = await supabase
        .from('space_chats')
        .select('chat_id')
        .eq('space_id', id)
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
    }
    
    // For user spaces (DMs), check if current user is the other participant
    if (!hasAccess && space.category === 'user') {
      const { data: currentUser } = await supabase
        .from('users')
        .select('email, name')
        .eq('id', req.userId)
        .single();
      
      hasAccess = currentUser && 
        (space.name === currentUser.email || space.name === currentUser.name);
      
      // Also check if there's a chat for this space and current user is a participant
      if (!hasAccess) {
        const { data: spaceChat } = await supabase
          .from('space_chats')
          .select('chat_id')
          .eq('space_id', id)
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
      }
    }
    
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const { data: tabs, error: tabsError } = await supabase
      .from('tabs')
      .select('*')
      .eq('space_id', id)
      .order('position', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    
    const chatUrl = `luna://chat/${id}`;
    let finalTabs = tabs || [];
    
    if (!finalTabs.some(t => t.url === chatUrl)) {
      const { data: chatTab } = await supabase
        .from('tabs')
        .insert({
          space_id: id,
          title: 'Chat',
          url: chatUrl,
          user_id: req.userId,
          type: 'chat'
        })
        .select('*')
        .single();
      
      if (chatTab) {
        finalTabs = [chatTab, ...finalTabs];
      }
    } else {
      const chatTabIndex = finalTabs.findIndex(t => t.url === chatUrl);
      if (chatTabIndex > 0) {
        const chatTab = finalTabs[chatTabIndex];
        finalTabs.splice(chatTabIndex, 1);
        finalTabs.unshift(chatTab);
      }
    }
    
    res.json({ space, tabs: finalTabs });
  } catch (error) {
    console.error('Get space error:', error);
    res.status(500).json({ error: 'Failed to get space' });
  }
});

// Create space
router.post('/', async (req, res) => {
  try {
    const { name, category, avatar_emoji, avatar_color, avatar_photo, participant_ids } = req.body;
    
    if (!name || !category) {
      return res.status(400).json({ error: 'Name and category are required' });
    }
    
    // Groups are not supported - only DMs (one-on-one chats)
    // Ignore participant_ids if provided (for backward compatibility)
    
    // For user spaces (DMs), check if a space already exists between these two users
    let otherUser = null;
    if (category === 'user') {
      try {
        // Find the other user by name/email
        const { data: foundOtherUser, error: otherUserError } = await supabase
          .from('users')
          .select('id, email, name, avatar_photo')
          .or(`email.eq.${name},name.eq.${name}`)
          .neq('id', req.userId)
          .single();
        
        if (!otherUserError && foundOtherUser) {
          otherUser = foundOtherUser;
        }
        
        // Get current user info
        const { data: currentUser } = await supabase
          .from('users')
          .select('email, name')
          .eq('id', req.userId)
          .single();
        
        if (otherUser && currentUser) {
          // Check ALL user spaces between these two users
          // This is the most reliable method - verifies both users are chat participants
          const { data: allUserSpaces, error: allSpacesError } = await supabase
            .from('spaces')
            .select('*')
            .eq('category', 'user')
            .eq('archived', false)
            .or(`user_id.eq.${req.userId},user_id.eq.${otherUser.id}`);
          
          if (!allSpacesError && allUserSpaces && allUserSpaces.length > 0) {
            // Check each space to see if it's a DM between these two users
            for (const space of allUserSpaces) {
              const { data: spaceChat } = await supabase
                .from('space_chats')
                .select('chat_id')
                .eq('space_id', space.id)
                .maybeSingle();
              
              if (spaceChat) {
                // Check if both users are participants in this chat
                const { data: participants } = await supabase
                  .from('chat_participants')
                  .select('user_id')
                  .eq('chat_id', spaceChat.chat_id)
                  .in('user_id', [req.userId, otherUser.id]);
                
                const participantIds = participants?.map(p => p.user_id) || [];
                const hasBothUsers = participantIds.includes(req.userId) && participantIds.includes(otherUser.id);
                
                if (hasBothUsers) {
                  // Both users are participants - this is the DM we're looking for
                  return res.json({ space: space });
                }
              }
            }
          }
          
          // Fallback: Check for existing space by name match
          const { data: existingSpace1 } = await supabase
            .from('spaces')
            .select('*')
            .eq('user_id', req.userId)
            .eq('category', 'user')
            .eq('archived', false)
            .or(`name.eq.${otherUser.email},name.eq.${otherUser.name}`)
            .limit(1)
            .maybeSingle();
          
          if (existingSpace1) {
            existingSpace1.other_user_photo = otherUser.avatar_photo;
            return res.json({ space: existingSpace1 });
          }
          
          // Check for existing space owned by other user
          const { data: existingSpace2 } = await supabase
            .from('spaces')
            .select('*')
            .eq('user_id', otherUser.id)
            .eq('category', 'user')
            .eq('archived', false)
            .or(`name.eq.${currentUser.email},name.eq.${currentUser.name}`)
            .limit(1)
            .maybeSingle();
          
          if (existingSpace2) {
            // El otro usuario ya tiene un espacio con un chat compartido
            // Retornar el MISMO espacio (no crear uno nuevo)
            // Ambos usuarios verán el mismo espacio y los mismos tabs
            const { data: spaceChat } = await supabase
              .from('space_chats')
              .select('chat_id')
              .eq('space_id', existingSpace2.id)
              .maybeSingle();
            
            if (spaceChat) {
              // Verificar que el usuario actual es participante
              const { data: participant } = await supabase
                .from('chat_participants')
                .select('id')
                .eq('chat_id', spaceChat.chat_id)
                .eq('user_id', req.userId)
                .maybeSingle();
              
              if (!participant) {
                // El usuario no es participante - agregarlo al chat
                await supabase
                  .from('chat_participants')
                  .insert({ chat_id: spaceChat.chat_id, user_id: req.userId });
              }
              
              // Enriquecer con información del otro usuario (desde la perspectiva del usuario actual)
              existingSpace2.display_name = otherUser.name || otherUser.email;
              existingSpace2.other_user_id = otherUser.id;
              existingSpace2.other_user_photo = otherUser.avatar_photo;
              
              // Retornar el mismo espacio existente
              return res.json({ space: existingSpace2 });
            }
            // Si no hay chat, continuar para crear uno nuevo normalmente
          }
        }
        // If user not found, continue to create space anyway (might be a personal notes space)
      } catch (searchError) {
        console.error('Error during space search:', searchError);
        // Continue to create new space if search fails
      }
    }
    
    // Only sync with Notion for projects (category === 'project')
    let notionPageId = null;
    let notionPageUrl = null;
    
    if (category === 'project') {
      // Get Notion config from environment variables (global only)
      const apiKey = process.env.NOTION_API_KEY;
      const databaseId = process.env.NOTION_DATABASE_ID;
      
      // Create Notion page if config exists
      if (apiKey && databaseId) {
        try {
          const notionPage = await createNotionPage(
            apiKey,
            databaseId,
            name.trim()
          );
          notionPageId = notionPage.id;
          notionPageUrl = notionPage.url;
        } catch (notionError) {
          console.error('Failed to create Notion page:', notionError);
          // Continue creating space even if Notion fails
        }
      }
    }
    
    // Get max position for this category
    const { data: maxPosSpace, error: maxPosError } = await supabase
      .from('spaces')
      .select('position')
      .eq('user_id', req.userId)
      .eq('category', category)
      .is('parent_id', null)
      .order('position', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    
    // If error or no spaces found, start at position 0
    const position = maxPosError || !maxPosSpace ? 0 : (maxPosSpace.position || 0) + 1;
    
    const { data: space, error } = await supabase
      .from('spaces')
      .insert({
        name: name.trim(),
        category,
        user_id: req.userId,
        avatar_emoji: avatar_emoji || null,
        avatar_color: avatar_color || null,
        avatar_photo: avatar_photo || null,
        position,
        notion_page_id: notionPageId,
        notion_page_url: notionPageUrl,
        archived: false
      })
      .select('*')
      .single();
    
    if (error) {
      console.error('Error creating space:', error);
      return res.status(500).json({ error: 'Failed to create space' });
    }
    
    // Create initial Chat tab
    const chatUrl = `luna://chat/${space.id}`;
    await supabase
      .from('tabs')
      .insert({
        space_id: space.id,
        title: 'Chat',
        url: chatUrl,
        user_id: req.userId,
        type: 'chat'
      });
    
    // For user spaces, create the chat immediately when creating the space
    // This prevents multiple chats from being created by concurrent requests
    if (space.category === 'user') {
      // Only support DMs (one-on-one chats) - no groups
      let allParticipantIds = [];
      if (otherUser) {
        // DM: just current user and other user
        allParticipantIds = [req.userId, otherUser.id];
      } else {
        // Personal notes: just current user
        allParticipantIds = [req.userId];
      }
      
      // For DMs (2 participants), check if a chat already exists
      let sharedChatId = null;
      if (otherUser) {
        // For DMs, check if there's already a shared chat with the other user
        const { data: userChats } = await supabase
          .from('chat_participants')
          .select('chat_id')
          .eq('user_id', req.userId);
        
        if (userChats && userChats.length > 0) {
          const chatIds = userChats.map(c => c.chat_id);
          
          // Check which of these chats also has the other user as participant
          const { data: sharedChats } = await supabase
            .from('chat_participants')
            .select('chat_id')
            .in('chat_id', chatIds)
            .eq('user_id', otherUser.id);
          
          if (sharedChats && sharedChats.length > 0) {
            // Found a shared chat - use it
            sharedChatId = sharedChats[0].chat_id;
          }
        }
      }
      
      // Create or use existing chat
      let chatId;
      if (sharedChatId) {
        chatId = sharedChatId;
      } else {
        // Create new chat
        const { data: chat } = await supabase
          .from('chats')
          .insert({})
          .select('id')
          .single();
        
        if (chat) {
          chatId = chat.id;
        }
      }
      
      if (chatId) {
        // Link space to chat
        await supabase
          .from('space_chats')
          .insert({ space_id: space.id, chat_id: chatId });
        
        // Add all participants to the chat
        for (const participantId of allParticipantIds) {
          await supabase
            .from('chat_participants')
            .insert({ chat_id: chatId, user_id: participantId });
        }
      }
      
      // Add other_user_photo if it's a DM
      if (otherUser) {
        space.other_user_photo = otherUser.avatar_photo;
      }
    }
    
    res.json({ space });
  } catch (error) {
    console.error('Create space error:', error);
    res.status(500).json({ error: 'Failed to create space' });
  }
});

// Update space
router.put('/:id', async (req, res) => {
  try {
    const { name, avatar_emoji, avatar_color, avatar_photo, parent_id, is_expanded } = req.body;
    
    const { data: existing } = await supabase
      .from('spaces')
      .select('id, notion_page_id, category')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();
    
    if (!existing) {
      return res.status(404).json({ error: 'Space not found' });
    }
    
    // If name is being updated and space has Notion page, sync with Notion
    if (name !== undefined && existing.notion_page_id && existing.category === 'project') {
      const apiKey = process.env.NOTION_API_KEY;
      
      if (apiKey) {
        try {
          await updateNotionPageName(apiKey, existing.notion_page_id, name.trim());
        } catch (notionError) {
          console.error('Failed to update Notion page name:', notionError);
          // Continue updating space even if Notion fails
        }
      }
    }
    
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (avatar_emoji !== undefined) updates.avatar_emoji = avatar_emoji;
    if (avatar_color !== undefined) updates.avatar_color = avatar_color;
    if (avatar_photo !== undefined) updates.avatar_photo = avatar_photo;
    if (parent_id !== undefined) updates.parent_id = parent_id;
    if (is_expanded !== undefined) updates.is_expanded = is_expanded;
    
    const { data: space, error } = await supabase
      .from('spaces')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select('*')
      .single();
    
    if (error) {
      console.error('Error updating space:', error);
      return res.status(500).json({ error: 'Failed to update space' });
    }
    
    res.json({ space });
  } catch (error) {
    console.error('Update space error:', error);
    res.status(500).json({ error: 'Failed to update space' });
  }
});

// Reorder spaces
router.post('/reorder', async (req, res) => {
  try {
    const { spaceId, targetId, position: dropPosition, targetParentId } = req.body;
    
    if (!spaceId || !targetId || !dropPosition) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const { data: allSpaces } = await supabase
      .from('spaces')
      .select('*')
      .eq('user_id', req.userId);
    
    if (!allSpaces) {
      return res.status(500).json({ error: 'Failed to fetch spaces' });
    }
    
    const space = allSpaces.find(s => s.id === spaceId);
    const target = allSpaces.find(s => s.id === targetId);
    
    if (!space || !target) {
      return res.status(404).json({ error: 'Space or target not found' });
    }
    
    // Helper function to check if a space has a specific parent in its parent_id array
    const hasParent = (space, parentId) => {
      if (!parentId) {
        // Check if space has no parents (empty array or null)
        const parentIds = space.parent_id || [];
        return Array.isArray(parentIds) ? parentIds.length === 0 : !parentIds;
      }
      const parentIds = space.parent_id || [];
      return Array.isArray(parentIds) ? parentIds.includes(parentId) : parentIds === parentId;
    };
    
    const siblings = allSpaces.filter(s => 
      s.id !== spaceId && 
      hasParent(s, targetParentId)
    ).sort((a, b) => (a.position || 0) - (b.position || 0));
    
    let newPosition;
    if (dropPosition === 'before') {
      newPosition = target.position || 0;
    } else if (dropPosition === 'after') {
      newPosition = (target.position || 0) + 1;
    } else if (dropPosition === 'inside') {
      // Cuando se arrastra dentro de otro proyecto, ponerlo al final de los hijos
      // Buscar hijos que tengan targetId en su array de parent_id
      const children = allSpaces.filter(s => {
        const parentIds = s.parent_id || [];
        return Array.isArray(parentIds) ? parentIds.includes(targetId) : parentIds === targetId;
      }).filter(s => s.id !== spaceId);
      
      newPosition = children.length > 0 
        ? Math.max(...children.map(c => c.position || 0)) + 1 
        : 0;
      
      // Obtener el proyecto para verificar si tiene múltiples tags
      const projectTags = space.tags || [];
      const tagsArray = Array.isArray(projectTags) ? projectTags : (typeof projectTags === 'string' ? JSON.parse(projectTags) : []);
      const hasMultipleTags = tagsArray.length > 1;
      
      // Obtener parent_id actual (puede ser array o string/null)
      let currentParentIds = space.parent_id || [];
      if (!Array.isArray(currentParentIds)) {
        currentParentIds = currentParentIds ? [currentParentIds] : [];
      }
      
      // Agregar targetId al array si no existe (para múltiples tags) o reemplazar (para 1 tag)
      let newParentIds;
      if (hasMultipleTags) {
        // Agregar al array si no existe
        newParentIds = currentParentIds.includes(targetId) 
          ? currentParentIds 
          : [...currentParentIds, targetId];
      } else {
        // Reemplazar con solo este parent
        newParentIds = [targetId];
      }
      
      // Actualizar parent_id (ahora es array) y position
      const { data: updatedSpace } = await supabase
        .from('spaces')
        .update({ parent_id: newParentIds, position: newPosition })
        .eq('id', spaceId)
        .eq('user_id', req.userId)
        .select('notion_page_id, category')
        .single();
      
      // Sync with Notion if space has notion_page_id and is a project
      if (updatedSpace?.notion_page_id && updatedSpace?.category === 'project') {
        const targetSpace = allSpaces.find(s => s.id === targetId);
        if (targetSpace?.notion_page_id) {
          try {
            const apiKey = process.env.NOTION_API_KEY;
            if (apiKey) {
              // Agregar parent a Notion (no reemplazar)
              await addNotionPageParent(apiKey, updatedSpace.notion_page_id, targetSpace.notion_page_id);
            }
          } catch (notionError) {
            console.error('Failed to update Notion page parent:', notionError);
            // Continue even if Notion update fails
          }
        }
      }
      
      return res.json({ success: true });
    } else if (!targetId && targetParentId === null) {
      // Moving to root level (removing from all parents)
      const rootSiblings = allSpaces.filter(s => {
        const parentIds = s.parent_id || [];
        return Array.isArray(parentIds) ? parentIds.length === 0 : !parentIds;
      }).filter(s => s.id !== spaceId);
      
      newPosition = rootSiblings.length > 0 
        ? Math.max(...rootSiblings.map(s => s.position || 0)) + 1 
        : 0;
      
      // Obtener notion_page_ids de todos los parents actuales para removerlos de Notion
      const currentParentIds = space.parent_id || [];
      const parentIdsArray = Array.isArray(currentParentIds) ? currentParentIds : (currentParentIds ? [currentParentIds] : []);
      
      // Actualizar parent_id a array vacío y position
      const { data: updatedSpace } = await supabase
        .from('spaces')
        .update({ parent_id: [], position: newPosition })
        .eq('id', spaceId)
        .eq('user_id', req.userId)
        .select('notion_page_id, category')
        .single();
      
      // Sync with Notion - remove all parent relations
      if (updatedSpace?.notion_page_id && updatedSpace?.category === 'project') {
        try {
          const apiKey = process.env.NOTION_API_KEY;
          if (apiKey) {
            // Remover todos los parents de Notion
            for (const parentId of parentIdsArray) {
              const { data: parentSpace } = await supabase
                .from('spaces')
                .select('notion_page_id')
                .eq('id', parentId)
                .eq('user_id', req.userId)
                .maybeSingle();
              
              if (parentSpace?.notion_page_id) {
                await removeNotionPageParent(apiKey, updatedSpace.notion_page_id, parentSpace.notion_page_id);
              }
            }
          }
        } catch (notionError) {
          console.error('Failed to remove Notion page parents:', notionError);
          // Continue even if Notion update fails
        }
      }
      
      return res.json({ success: true });
    }
    
    // Para 'before' y 'after', verificar si el parent_id cambió
    // Comparar arrays de parent_id
    const oldParentIds = Array.isArray(space.parent_id) ? space.parent_id : (space.parent_id ? [space.parent_id] : []);
    const newParentIds = targetParentId ? [targetParentId] : [];
    const parentChanged = JSON.stringify(oldParentIds.sort()) !== JSON.stringify(newParentIds.sort());
    
    // Para 'before' y 'after', solo actualizar position (no cambiar parent_id)
    // El parent_id ya está correcto porque estamos reordenando dentro del mismo grupo
    const { data: updatedSpace } = await supabase
      .from('spaces')
      .update({ position: newPosition })
      .eq('id', spaceId)
      .eq('user_id', req.userId)
      .select('notion_page_id, category, parent_id')
      .single();
    
    // No sincronizar con Notion para 'before' y 'after' porque solo cambia el orden, no el parent
    // Si solo cambió el orden (mismo parent), NO sincronizar con Notion
    
    // Ajustar posiciones de los siblings
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      const currentPos = sibling.position || 0;
      
      if (dropPosition === 'before' && currentPos >= newPosition) {
        await supabase
          .from('spaces')
          .update({ position: currentPos + 1 })
          .eq('id', sibling.id)
          .eq('user_id', req.userId);
      } else if (dropPosition === 'after' && currentPos > (target.position || 0)) {
        await supabase
          .from('spaces')
          .update({ position: currentPos + 1 })
          .eq('id', sibling.id)
          .eq('user_id', req.userId);
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Reorder error:', error);
    res.status(500).json({ error: 'Failed to reorder spaces' });
  }
});

// Archive space (different from delete - keeps the space but marks it as archived)
router.patch('/:id/archive', async (req, res) => {
  try {
    const { archived = true } = req.body;
    
    // Verify space belongs to user
    const { data: existingSpace } = await supabase
      .from('spaces')
      .select('id, notion_page_id, category')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();
    
    if (!existingSpace) {
      return res.status(404).json({ error: 'Space not found' });
    }
    
    // Update archived status in database FIRST for faster response
    const { data: space, error } = await supabase
      .from('spaces')
      .update({ archived: Boolean(archived) })
      .eq('id', req.params.id)
      .select('*')
      .single();
    
    if (error) {
      console.error('Error archiving space:', error);
      return res.status(500).json({ error: 'Failed to archive space' });
    }
    
    // Respond immediately (optimistic UI)
    res.json({ space });
    
    // NOTE: Archive functionality no longer syncs with Notion
    // Each user can archive projects independently based on their own preferences
  } catch (error) {
    console.error('Archive space error:', error);
    res.status(500).json({ error: 'Failed to archive space' });
  }
});

// Update tags for a space
router.patch('/:id/tags', async (req, res) => {
  try {
    const { tags } = req.body;
    
    if (!Array.isArray(tags)) {
      return res.status(400).json({ error: 'Tags must be an array' });
    }
    
    // Verify space belongs to user
    const { data: existingSpace } = await supabase
      .from('spaces')
      .select('id, notion_page_id, category, user_id')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();
    
    if (!existingSpace) {
      return res.status(404).json({ error: 'Space not found' });
    }
    
    // Update tags in database
    const { data: space, error } = await supabase
      .from('spaces')
      .update({ 
        tags: tags,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select('*')
      .single();
    
    if (error) {
      console.error('Error updating tags:', error);
      return res.status(500).json({ error: 'Failed to update tags' });
    }
    
    // Sync with Notion if the project has a notion_page_id
    if (existingSpace.notion_page_id && existingSpace.category === 'project') {
      const apiKey = process.env.NOTION_API_KEY;
      
      if (apiKey) {
        // Update tags in Notion asynchronously (don't block response)
        setImmediate(async () => {
          try {
            await updateNotionPageTags(apiKey, existingSpace.notion_page_id, tags);
            console.log(`✅ Tags synced to Notion for project ${existingSpace.id}`);
          } catch (notionError) {
            console.error('❌ Failed to sync tags to Notion:', notionError);
            // Don't fail the request if Notion sync fails
          }
        });
      }
    }
    
    res.json({ space });
  } catch (error) {
    console.error('Update tags error:', error);
    res.status(500).json({ error: 'Failed to update tags' });
  }
});

// Delete space (permanently delete - also deletes from Notion and all tabs)
// Only the owner can delete the space
router.delete('/:id', async (req, res) => {
  try {
    console.log('[DELETE SPACE] Request received for space:', req.params.id);
    console.log('[DELETE SPACE] User ID:', req.userId);
    
    const { data: existing } = await supabase
      .from('spaces')
      .select('id, notion_page_id, category, user_id')
      .eq('id', req.params.id)
      .single();
    
    console.log('[DELETE SPACE] Found space:', existing);
    
    if (!existing) {
      console.log('[DELETE SPACE] Space not found');
      return res.status(404).json({ error: 'Space not found' });
    }
    
    // Verify user is the owner
    if (existing.user_id !== req.userId) {
      console.log('[DELETE SPACE] User is not owner. Space owner:', existing.user_id, 'Current user:', req.userId);
      return res.status(403).json({ error: 'Only the project owner can delete the project' });
    }
    
    console.log('[DELETE SPACE] User is owner, proceeding with deletion');
    console.log('[DELETE SPACE] User is owner, proceeding with deletion');
    
    // Delete from Notion if it has a notion_page_id
    if (existing.notion_page_id && existing.category === 'project') {
      console.log('[DELETE SPACE] Archiving Notion page:', existing.notion_page_id);
      const apiKey = process.env.NOTION_API_KEY;
      
      if (apiKey) {
        try {
          // Archive the page in Notion (Notion doesn't support permanent deletion via API)
          await archiveNotionPage(apiKey, existing.notion_page_id, true);
          console.log('[DELETE SPACE] Notion page archived successfully');
        } catch (notionError) {
          console.error('[DELETE SPACE] Failed to archive Notion page:', notionError);
          // Continue with deletion even if Notion fails
        }
      }
    }
    
    // Delete all tabs associated with this space
    console.log('[DELETE SPACE] Deleting tabs for space:', req.params.id);
    const { error: tabsError } = await supabase
      .from('tabs')
      .delete()
      .eq('space_id', req.params.id);
    
    if (tabsError) {
      console.error('[DELETE SPACE] Error deleting tabs:', tabsError);
      // Continue with space deletion even if tabs deletion fails
    } else {
      console.log('[DELETE SPACE] Tabs deleted successfully');
    }
    
    // Delete the space
    console.log('[DELETE SPACE] Deleting space:', req.params.id);
    const { error } = await supabase
      .from('spaces')
      .delete()
      .eq('id', req.params.id);
    
    if (error) {
      console.error('[DELETE SPACE] Error deleting space:', error);
      return res.status(500).json({ error: 'Failed to delete space' });
    }
    
    console.log('[DELETE SPACE] Space deleted successfully');
    res.json({ success: true });
  } catch (error) {
    console.error('[DELETE SPACE] Unexpected error:', error);
    res.status(500).json({ error: 'Failed to delete space' });
  }
});

export default router;

