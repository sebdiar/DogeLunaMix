import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: join(__dirname, '../.env') });

import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import tabsRoutes from './routes/tabs.js';
import spacesRoutes from './routes/spaces.js';
import chatRoutes from './routes/chat.js';
import notionRoutes from './routes/notion.js';
import notificationsRoutes from './routes/notifications.js';

const app = express();
const PORT = process.env.BACKEND_PORT || 3001;

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '10mb' })); // Increase limit for base64 image uploads
app.use(cookieParser());

// Log all requests for debugging
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/tabs', tabsRoutes);
app.use('/api/spaces', spacesRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/notion', notionRoutes);
app.use('/api/notifications', notificationsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: req.body,
    query: req.query
  });
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`DogeUB Backend running on port ${PORT}`);
  
  // Initialize Notion tasks reminders cron job (after server starts)
  // Use dynamic import to avoid breaking server if module doesn't exist
  import('node-cron').then(cronModule => {
    return import('./services/notion-tasks-reminders.js').then(remindersModule => {
      const cron = cronModule.default;
      const sendMorningTaskReminders = remindersModule.sendMorningTaskReminders;
      
      try {
        const reminderEnabled = process.env.NOTION_TASKS_REMINDER_ENABLED === 'true';
        let reminderHour = parseInt(process.env.NOTION_TASKS_REMINDER_HOUR || '9', 10);

        // Validate hour (0-23)
        if (reminderHour < 0 || reminderHour > 23) {
          console.error(`\n❌ Invalid NOTION_TASKS_REMINDER_HOUR: ${reminderHour}. Must be between 0-23. Using default: 9\n`);
          reminderHour = 9;
        }

        console.log('\n📅 Notion Task Reminders Configuration:');
        console.log(`   Enabled: ${reminderEnabled}`);
        console.log(`   Scheduled hour: ${reminderHour}:00 (server timezone)`);
        console.log(`   Server timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
        console.log(`   Current server time: ${new Date().toLocaleString()}`);
        console.log(`   API Key: ${process.env.NOTION_API_KEY ? 'SET' : 'NOT SET'}`);
        console.log(`   Tasks DB ID: ${process.env.NOTION_TASKS_DATABASE_ID || 'NOT SET'}\n`);

        if (reminderEnabled) {
          // Schedule daily reminders at specified hour (default: 9 AM)
          // Cron format: minute hour day month day-of-week
          // Note: node-cron uses the server's timezone
          const cronExpression = `0 ${reminderHour} * * *`;
          
          cron.schedule(cronExpression, async () => {
            const now = new Date();
            console.log(`\n${'='.repeat(60)}`);
            console.log(`⏰ CRON JOB TRIGGERED - Running daily task reminders`);
            console.log(`   Triggered at: ${now.toISOString()}`);
            console.log(`   Local time: ${now.toLocaleString()}`);
            console.log(`${'='.repeat(60)}\n`);
            try {
              await sendMorningTaskReminders();
            } catch (error) {
              console.error('\n❌ Error running task reminders from cron job:', error);
              console.error('Stack trace:', error.stack);
            }
          });
          
          console.log(`✅ Task reminders scheduled to run daily at ${reminderHour}:00`);
          console.log(`   Cron expression: ${cronExpression}`);
          console.log(`   Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
          console.log(`   Next run will be at ${reminderHour}:00 tomorrow (server time)\n`);
        } else {
          console.log('⚠️  Task reminders are DISABLED (set NOTION_TASKS_REMINDER_ENABLED=true to enable)\n');
        }
      } catch (error) {
        console.error('\n❌ Error initializing task reminders:', error);
        console.error('Stack trace:', error.stack);
        // Don't crash the server if reminders fail to initialize
      }
    }).catch(error => {
      console.error('\n❌ Error importing notion-tasks-reminders module:', error);
    });
  }).catch(error => {
    console.warn('\n⚠️  node-cron module not available - task reminders will not run automatically');
    console.warn('   Install with: npm install node-cron');
    console.warn('   Or run manually with: node backend/scripts/test-overdue-reminders.js\n');
  });
});

// Handle port already in use errors gracefully
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Attempting to free the port...`);
    // Try to find and kill the process using the port
    import('child_process').then(({ exec }) => {
      // First, check if there's actually a process using the port
      exec(`lsof -ti:${PORT}`, (lsofError, stdout) => {
        if (lsofError || !stdout.trim()) {
          // No process found - port might be in a weird state, wait and retry
          console.log('⚠️  No process found on port. Port may be in TIME_WAIT state.');
          console.log('💡 Waiting 3 seconds for port to be released, then restarting...');
          setTimeout(() => {
            process.exit(1); // Exit to let watcher restart
          }, 3000);
          return;
        }
        
        // Process found, try to kill it
        const pid = stdout.trim().split('\n')[0]; // Get first PID
        console.log(`Found process ${pid} on port ${PORT}. Killing...`);
        exec(`kill -9 ${pid}`, (killError) => {
          if (killError) {
            console.error('Could not kill existing process:', killError.message);
            console.error('Please manually kill the process using port', PORT);
            process.exit(1);
          } else {
            console.log(`✅ Killed process ${pid}. Waiting 2 seconds before retry...`);
            setTimeout(() => {
              process.exit(1); // Exit to let watcher restart
            }, 2000);
          }
        });
      });
    }).catch(() => {
      console.error('Please manually kill the process using port', PORT);
      process.exit(1);
    });
  } else {
    throw err;
  }
});

