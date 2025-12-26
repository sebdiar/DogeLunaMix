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
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
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
        const reminderHour = parseInt(process.env.NOTION_TASKS_REMINDER_HOUR || '6', 10);

        if (reminderEnabled) {
          // Schedule daily reminders at specified hour (default: 6 AM)
          // Cron format: minute hour day month day-of-week
          const cronExpression = `0 ${reminderHour} * * *`;
          
          cron.schedule(cronExpression, async () => {
            console.log(`⏰ Running daily task reminders at ${reminderHour}:00...`);
            try {
              await sendMorningTaskReminders();
            } catch (error) {
              console.error('Error running task reminders:', error);
            }
          });
          
          console.log(`✅ Task reminders scheduled to run daily at ${reminderHour}:00`);
        }
      } catch (error) {
        console.error('Error initializing task reminders:', error);
        // Don't crash the server if reminders fail to initialize
      }
    });
  }).catch(error => {
    // Cron job modules not available - continue without it (not an error)
    // This is normal if the Notion tasks feature is not fully configured
  });
});

// Handle port already in use errors gracefully
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Killing existing process...`);
    // Try to find and kill the process using the port
    import('child_process').then(({ exec }) => {
      exec(`lsof -ti:${PORT} | xargs kill -9`, (error) => {
        if (error) {
          console.error('Could not kill existing process:', error.message);
          console.error('Please manually kill the process using port', PORT);
          process.exit(1);
        } else {
          console.log('Killed existing process. Restart the server.');
          process.exit(0);
        }
      });
    }).catch(() => {
      console.error('Please manually kill the process using port', PORT);
      process.exit(1);
    });
  } else {
    throw err;
  }
});

