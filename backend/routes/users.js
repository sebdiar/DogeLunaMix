import express from 'express';
import supabase from '../config/database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

// Get all users (for creating DMs) - includes current user at the end
router.get('/', async (req, res) => {
  try {
    // Get all other users
    const { data: otherUsers, error: otherUsersError } = await supabase
      .from('users')
      .select('id, email, name, avatar_photo, created_at')
      .neq('id', req.userId)
      .order('name', { ascending: true });
    
    if (otherUsersError) {
      console.error('Error fetching other users:', otherUsersError);
      return res.status(500).json({ error: 'Failed to fetch users' });
    }
    
    // Get current user
    const { data: currentUser, error: currentUserError } = await supabase
      .from('users')
      .select('id, email, name, avatar_photo, created_at')
      .eq('id', req.userId)
      .single();
    
    if (currentUserError) {
      console.error('Error fetching current user:', currentUserError);
      // Continue without current user if there's an error
    }
    
    // Combine: other users first, then current user at the end
    const users = [...(otherUsers || [])];
    if (currentUser) {
      users.push(currentUser);
    }
    
    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Search users by name or email - includes current user if matches
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({ users: [] });
    }
    
    // Search other users
    const { data: otherUsers, error: otherUsersError } = await supabase
      .from('users')
      .select('id, email, name, avatar_photo')
      .neq('id', req.userId)
      .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(10);
    
    if (otherUsersError) {
      console.error('Error searching other users:', otherUsersError);
      return res.status(500).json({ error: 'Search failed' });
    }
    
    // Check if current user matches the search
    const { data: currentUser, error: currentUserError } = await supabase
      .from('users')
      .select('id, email, name, avatar_photo')
      .eq('id', req.userId)
      .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
      .single();
    
    // Combine: other users first, then current user if it matches
    const users = [...(otherUsers || [])];
    if (currentUser && !currentUserError) {
      users.push(currentUser);
    }
    
    res.json({ users });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get Supabase public credentials for frontend Realtime
router.get('/supabase-config', async (req, res) => {
  try {
    // Return public credentials (safe to expose to frontend)
    // Try SUPABASE_ANON_KEY first, then SUPABASE_KEY as fallback
    // SUPABASE_KEY should be the anon/public key (not service_role key)
    const supabaseUrl = process.env.SUPABASE_URL?.trim();
    let supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim();
    
    // Fallback to SUPABASE_KEY if SUPABASE_ANON_KEY is not set
    // This assumes SUPABASE_KEY is the anon key (public key)
    if (!supabaseAnonKey) {
      supabaseAnonKey = process.env.SUPABASE_KEY?.trim();
    }
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Missing Supabase config for frontend:', {
        url: supabaseUrl ? 'SET' : 'MISSING',
        anonKey: supabaseAnonKey ? 'SET' : 'MISSING'
      });
      return res.status(500).json({ error: 'Supabase configuration missing' });
    }
    
    res.json({
      url: supabaseUrl,
      anonKey: supabaseAnonKey
    });
  } catch (error) {
    console.error('Get Supabase config error:', error);
    res.status(500).json({ error: 'Failed to get Supabase config' });
  }
});

// Get user preferences (for tabs in "More" dropdown)
router.get('/preferences', async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('metadata')
      .eq('id', req.userId)
      .single();
    
    if (error) {
      console.error('Error fetching user preferences:', error);
      return res.status(500).json({ error: 'Failed to fetch preferences' });
    }
    
    const metadata = user?.metadata || {};
    const preferences = {
      mobile_more_tab_ids: metadata.mobile_more_tab_ids || []
    };
    
    res.json({ preferences });
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({ error: 'Failed to get preferences' });
  }
});

// Update user preferences
router.put('/preferences', async (req, res) => {
  try {
    const { mobile_more_tab_ids } = req.body;
    
    // Get current metadata
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('metadata')
      .eq('id', req.userId)
      .single();
    
    if (fetchError) {
      console.error('Error fetching user for preferences update:', fetchError);
      return res.status(500).json({ error: 'Failed to update preferences' });
    }
    
    const currentMetadata = user?.metadata || {};
    const updatedMetadata = {
      ...currentMetadata,
      ...(mobile_more_tab_ids !== undefined && { mobile_more_tab_ids })
    };
    
    const { error: updateError } = await supabase
      .from('users')
      .update({ metadata: updatedMetadata })
      .eq('id', req.userId);
    
    if (updateError) {
      console.error('Error updating user preferences:', updateError);
      return res.status(500).json({ error: 'Failed to update preferences' });
    }
    
    res.json({ 
      preferences: {
        mobile_more_tab_ids: updatedMetadata.mobile_more_tab_ids || []
      }
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// Update current user profile
router.put('/me', async (req, res) => {
  try {
    const { name, avatar_photo } = req.body;
    
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (avatar_photo !== undefined) {
      // Limit avatar_photo to reasonable size (max 1MB base64 = ~750KB image)
      if (avatar_photo.length > 1000000) {
        return res.status(400).json({ error: 'Image too large. Maximum size is 750KB.' });
      }
      updates.avatar_photo = avatar_photo;
    }
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    const { data: updatedUser, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.userId)
      .select('id, email, name, avatar_photo, created_at')
      .single();
    
    if (error) {
      console.error('Error updating user profile:', error);
      return res.status(500).json({ error: 'Failed to update profile' });
    }
    
    res.json({ user: updatedUser });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Delete user
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Prevent users from deleting themselves
    if (id === req.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    // Check if user exists
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, name')
      .eq('id', id)
      .single();
    
    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Delete user (cascade will handle related data)
    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', id);
    
    if (deleteError) {
      console.error('Error deleting user:', deleteError);
      return res.status(500).json({ error: 'Failed to delete user' });
    }
    
    res.json({ message: 'User deleted successfully', user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;

