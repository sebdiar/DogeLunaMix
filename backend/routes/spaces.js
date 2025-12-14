import express from 'express';
import supabase from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { createNotionPage, updateNotionPageName, archiveNotionPage, queryNotionPages } from '../services/notion.js';

const router = express.Router();
router.use(authenticate);

// Get spaces by category
router.get('/', async (req, res) => {
  try {
    const { category } = req.query;
    
    let query = supabase
      .from('spaces')
      .select('*')
      .eq('user_id', req.userId);
    
    if (category) {
      query = query.eq('category', category);
    }
    
    // By default, only show non-archived spaces (can be filtered later with ?archived=true)
    const { archived } = req.query;
    if (archived !== 'true') {
      query = query.eq('archived', false);
    }
    
    const { data: spacesData, error } = await query
      .order('position', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    
    if (error) {
      console.error('Error fetching spaces:', error);
      return res.status(500).json({ error: 'Failed to fetch spaces' });
    }
    
    let spaces = spacesData || [];
    
    // For projects, sync with Notion if configured (using global env vars only)
    if (category === 'project') {
      try {
        const apiKey = process.env.NOTION_API_KEY;
        const databaseId = process.env.NOTION_DATABASE_ID;
        
        if (apiKey && databaseId) {
          // Query all pages from Notion
          const notionPages = await queryNotionPages(apiKey, databaseId);
          
          // Create a map of existing spaces by notion_page_id
          const existingByNotionId = new Map();
          spaces.forEach(space => {
            if (space.notion_page_id) {
              existingByNotionId.set(space.notion_page_id, space);
            }
          });
          
          // Create a map of notion page ID -> local space ID for parent mapping
          const notionIdToSpaceId = new Map();
          spaces.forEach(space => {
            if (space.notion_page_id) {
              notionIdToSpaceId.set(space.notion_page_id, space.id);
            }
          });

          // First pass: create all root-level spaces (those without parents or whose parents don't exist yet)
          // Then second pass will handle children
          const notionPagesToProcess = [...notionPages];
          const processedNotionIds = new Set();
          
          // Process in multiple passes to handle hierarchy correctly
          let maxPasses = 10; // Safety limit
          let pass = 0;
          
          while (notionPagesToProcess.length > 0 && pass < maxPasses) {
            pass++;
            const pagesInThisPass = notionPagesToProcess.filter(notionPage => {
              // Skip if already processed
              if (processedNotionIds.has(notionPage.id)) return false;
              
              // Skip archived
              if (notionPage.archived) {
                processedNotionIds.add(notionPage.id);
                return false;
              }
              
              // Skip if already exists locally
              if (existingByNotionId.has(notionPage.id)) {
                processedNotionIds.add(notionPage.id);
                const existingSpace = existingByNotionId.get(notionPage.id);
                notionIdToSpaceId.set(notionPage.id, existingSpace.id);
                return false;
              }
              
              // Include if no parent, or parent already exists in our map
              if (!notionPage.parent_id || notionIdToSpaceId.has(notionPage.parent_id)) {
                return true;
              }
              
              return false;
            });
            
            for (const notionPage of pagesInThisPass) {
              // Find parent space ID if parent exists
              let parentSpaceId = null;
              if (notionPage.parent_id && notionIdToSpaceId.has(notionPage.parent_id)) {
                parentSpaceId = notionIdToSpaceId.get(notionPage.parent_id);
              }
              
              // Find max position for siblings (same parent or root level)
              const { data: maxPosSpace } = await supabase
                .from('spaces')
                .select('position')
                .eq('user_id', req.userId)
                .eq('category', 'project')
                .eq('parent_id', parentSpaceId || null)
                .order('position', { ascending: false, nullsFirst: false })
                .limit(1)
                .single();
              
              const position = (maxPosSpace?.position || 0) + 1;
              
              // Create space from Notion page
              const { data: newSpace } = await supabase
                .from('spaces')
                .insert({
                  user_id: req.userId,
                  name: notionPage.name,
                  category: 'project',
                  notion_page_id: notionPage.id,
                  notion_page_url: notionPage.url,
                  parent_id: parentSpaceId,
                  archived: false,
                  position
                })
                .select('*')
                .single();
              
              if (newSpace) {
                spaces.push(newSpace);
                notionIdToSpaceId.set(notionPage.id, newSpace.id);
                processedNotionIds.add(notionPage.id);
                
                // Create initial Chat tab
                const chatUrl = `luna://chat/${newSpace.id}`;
                await supabase
                  .from('tabs')
                  .insert({
                    space_id: newSpace.id,
                    title: 'Chat',
                    url: chatUrl,
                    user_id: req.userId,
                    type: 'chat'
                  });
              }
            }
            
            // Remove processed pages
            notionPagesToProcess.splice(0, pagesInThisPass.length);
          }
          
          // Update existing spaces' parent_id if it changed in Notion
          for (const notionPage of notionPages) {
            if (notionPage.archived) continue;
            
            const existingSpace = existingByNotionId.get(notionPage.id);
            if (existingSpace) {
              let parentSpaceId = null;
              if (notionPage.parent_id && notionIdToSpaceId.has(notionPage.parent_id)) {
                parentSpaceId = notionIdToSpaceId.get(notionPage.parent_id);
              }
              
              // Update parent_id if it changed
              if (existingSpace.parent_id !== parentSpaceId) {
                await supabase
                  .from('spaces')
                  .update({ parent_id: parentSpaceId })
                  .eq('id', existingSpace.id);
                existingSpace.parent_id = parentSpaceId;
              }
              
              // Update name if it changed in Notion
              if (existingSpace.name !== notionPage.name) {
                await supabase
                  .from('spaces')
                  .update({ name: notionPage.name })
                  .eq('id', existingSpace.id);
                existingSpace.name = notionPage.name;
              }
            }
          }
          
          // Update archived status for existing spaces based on Notion
          for (const space of spaces) {
            if (space.notion_page_id) {
              const notionPage = notionPages.find(p => p.id === space.notion_page_id);
              if (notionPage && space.archived !== notionPage.archived) {
                await supabase
                  .from('spaces')
                  .update({ archived: notionPage.archived })
                  .eq('id', space.id);
                space.archived = notionPage.archived;
              }
            }
          }
          
          // Filter: Only return spaces that come from Notion (have notion_page_id)
          // OR spaces without notion_page_id that were created manually before Notion sync
          // For now, let's show all spaces but prioritize Notion ones
          const notionSpaceIds = new Set(notionPages.map(p => p.id));
          const localNotionIds = new Set(spaces.filter(s => s.notion_page_id).map(s => s.notion_page_id));
          
          // Filter: Only return spaces that come from Notion (have notion_page_id)
          // Remove local spaces that don't have notion_page_id
          spaces = spaces.filter(s => s.notion_page_id);
          
          // Build hierarchy-aware sorted list (parents before children)
          const spacesById = new Map(spaces.map(s => [s.id, s]));
          const rootSpaces = spaces.filter(s => !s.parent_id || !spacesById.has(s.parent_id));
          
          function buildHierarchy(space) {
            const result = [space];
            const children = spaces.filter(s => s.parent_id === space.id);
            children.sort((a, b) => (a.position || 0) - (b.position || 0));
            for (const child of children) {
              result.push(...buildHierarchy(child));
            }
            return result;
          }
          
          const hierarchicalSpaces = [];
          rootSpaces.sort((a, b) => (a.position || 0) - (b.position || 0));
          for (const root of rootSpaces) {
            hierarchicalSpaces.push(...buildHierarchy(root));
          }
          
          // Replace spaces with hierarchical version
          const hierarchicalSpacesArray = hierarchicalSpaces;
          spaces = hierarchicalSpacesArray;
        }
      } catch (notionError) {
        console.error('Error syncing with Notion:', notionError);
        // Continue even if Notion sync fails
      }
    }
    
    // For user spaces (DMs), enrich with other user's info
    if (category === 'user') {
      const { data: currentUser } = await supabase
        .from('users')
        .select('email, name')
        .eq('id', req.userId)
        .single();
      
      // For spaces created by current user, get the other user's info
      for (let space of spaces) {
        // If name looks like an email, try to find the user
        if (space.name && space.name.includes('@')) {
          const { data: otherUser } = await supabase
            .from('users')
            .select('id, name, email')
            .or(`email.eq.${space.name},name.eq.${space.name}`)
            .neq('id', req.userId)
            .single();
          
          if (otherUser) {
            space.display_name = otherUser.name || otherUser.email;
            space.other_user_id = otherUser.id;
          } else {
            space.display_name = space.name;
          }
        } else {
          space.display_name = space.name;
        }
      }
      
      // Also get spaces where current user is a participant
      if (currentUser) {
        const { data: sharedSpaces } = await supabase
          .from('spaces')
          .select('*, owner:users!spaces_user_id_fkey(id, name, email)')
          .eq('category', 'user')
          .neq('user_id', req.userId)
          .or(`name.eq.${currentUser.email},name.eq.${currentUser.name}`);
        
        if (sharedSpaces && sharedSpaces.length > 0) {
          const mappedShared = sharedSpaces.map(s => ({
            ...s,
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
    
    if (!hasAccess && space.category === 'user') {
      const { data: currentUser } = await supabase
        .from('users')
        .select('email, name')
        .eq('id', req.userId)
        .single();
      
      hasAccess = currentUser && 
        (space.name === currentUser.email || space.name === currentUser.name);
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
    const { name, category, avatar_emoji, avatar_color, avatar_photo } = req.body;
    
    if (!name || !category) {
      return res.status(400).json({ error: 'Name and category are required' });
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
    
    const { data: maxPosSpace } = await supabase
      .from('spaces')
      .select('position')
      .eq('user_id', req.userId)
      .eq('category', category)
      .is('parent_id', null)
      .order('position', { ascending: false, nullsFirst: false })
      .limit(1)
      .single();
    
    const position = (maxPosSpace?.position || 0) + 1;
    
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
    
    const siblings = allSpaces.filter(s => 
      s.id !== spaceId && 
      ((s.parent_id === targetParentId) || (!s.parent_id && !targetParentId))
    ).sort((a, b) => (a.position || 0) - (b.position || 0));
    
    let newPosition;
    if (dropPosition === 'before') {
      newPosition = target.position || 0;
    } else if (dropPosition === 'after') {
      newPosition = (target.position || 0) + 1;
    } else {
      await supabase
        .from('spaces')
        .update({ parent_id: targetId, position: 0 })
        .eq('id', spaceId)
        .eq('user_id', req.userId);
      
      return res.json({ success: true });
    }
    
    await supabase
      .from('spaces')
      .update({ parent_id: targetParentId, position: newPosition })
      .eq('id', spaceId)
      .eq('user_id', req.userId);
    
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      const currentPos = sibling.position || 0;
      
      if (dropPosition === 'before' && currentPos >= newPosition) {
        await supabase
          .from('spaces')
          .update({ position: currentPos + 1 })
          .eq('id', sibling.id)
          .eq('user_id', req.userId);
      } else if (dropPosition === 'after' && currentPos > target.position) {
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
    
    // Sync with Notion in background (don't block response)
    if (existingSpace.notion_page_id && existingSpace.category === 'project') {
      const apiKey = process.env.NOTION_API_KEY;
      
      if (apiKey) {
        // Run Notion sync asynchronously without blocking
        archiveNotionPage(apiKey, existingSpace.notion_page_id, archived)
          .catch(notionError => {
            console.error('Failed to archive Notion page (non-blocking):', notionError);
            // Note: Space is already archived locally, sync will happen on next load
          });
      }
    }
  } catch (error) {
    console.error('Archive space error:', error);
    res.status(500).json({ error: 'Failed to archive space' });
  }
});

// Delete space (permanently delete - does NOT archive)
router.delete('/:id', async (req, res) => {
  try {
    const { data: existing } = await supabase
      .from('spaces')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();
    
    if (!existing) {
      return res.status(404).json({ error: 'Space not found' });
    }
    
    // Note: We do NOT archive in Notion when deleting - deletion is permanent
    // If user wants to keep in Notion, they should use archive instead
    
    const { error } = await supabase
      .from('spaces')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId);
    
    if (error) {
      console.error('Error deleting space:', error);
      return res.status(500).json({ error: 'Failed to delete space' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete space error:', error);
    res.status(500).json({ error: 'Failed to delete space' });
  }
});

export default router;

