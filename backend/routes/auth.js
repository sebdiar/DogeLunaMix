import express from 'express';
import bcrypt from 'bcryptjs';
import supabase from '../config/database.js';
import { generateToken, authenticate } from '../middleware/auth.js';
import { createNotionPage } from '../services/notion.js';

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    // Check if user exists
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();
    
    if (existing) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Create user
    const { data: user, error } = await supabase
      .from('users')
      .insert({
        email,
        password_hash: passwordHash,
        name: name || email.split('@')[0]
      })
      .select('id, email, name, avatar_photo')
      .single();
    
    if (error) {
      console.error('Register error:', error);
      return res.status(500).json({ error: 'Failed to create user' });
    }
    
    const token = generateToken(user);
    
    // Set cookie
    res.cookie('dogeub_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    // Create Notion page for user and tab (async, don't block response)
    // This runs in background so registration doesn't wait for Notion API
    (async () => {
      try {
        const apiKey = process.env.NOTION_API_KEY;
        const usersDatabaseId = process.env.NOTION_USERS_DATABASE_ID;
        const userName = user.name || user.email.split('@')[0];
        
        console.log(`[REGISTER] Processing Notion tab creation for user: ${userName} (${user.id})`);
        console.log(`[REGISTER] API Key present: ${!!apiKey}`);
        console.log(`[REGISTER] Users Database ID present: ${!!usersDatabaseId}`);
        
        if (apiKey && usersDatabaseId) {
          console.log(`[REGISTER] Creating Notion page for user: ${userName}`);
          
          // Create Notion page for the user
          const notionPage = await createNotionPage(
            apiKey,
            usersDatabaseId,
            userName
          );
          
          console.log(`[REGISTER] Notion page created: ${notionPage.url}`);
          
          // Create tab with Notion page URL
          // Position will be automatically set (defaults to 0 or max+1)
          const { data: newTab, error: tabError } = await supabase
            .from('tabs')
            .insert({
              user_id: user.id,
              title: userName,
              url: notionPage.url,
              is_expanded: true
            })
            .select('*')
            .single();
          
          if (tabError) {
            console.error(`[REGISTER] Error creating tab for user ${userName}:`, tabError);
            console.error(`[REGISTER] Tab error details:`, JSON.stringify(tabError, null, 2));
          } else {
            console.log(`[REGISTER] Tab created successfully for user ${userName}: ${newTab.id}`);
          }
        } else {
          console.log(`[REGISTER] Notion integration not configured for user ${userName}`);
          console.log(`[REGISTER] API Key: ${apiKey ? 'SET' : 'MISSING'}`);
          console.log(`[REGISTER] Users Database ID: ${usersDatabaseId ? 'SET' : 'MISSING'}`);
        }
      } catch (notionError) {
        console.error(`[REGISTER] Failed to create Notion page or tab for user ${user.name || user.email}:`, notionError);
        console.error(`[REGISTER] Error stack:`, notionError.stack);
        // Don't fail registration if Notion fails
      }
    })();
    
    res.json({ user, token });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    // Find user
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, avatar_photo, password_hash')
      .eq('email', email)
      .single();
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = generateToken(user);
    const { password_hash, ...userWithoutPassword } = user;
    
    // Set cookie
    res.cookie('dogeub_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    res.json({ user: userWithoutPassword, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
router.get('/me', authenticate, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, avatar_photo, created_at')
      .eq('id', req.userId)
      .single();
    
    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('dogeub_token', {
    httpOnly: true,
    secure: true,
    sameSite: 'none'
  });
  res.json({ success: true });
});

export default router;














