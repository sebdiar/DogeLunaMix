import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root (dogeub/.env)
dotenv.config({ path: join(__dirname, '../.env') });

import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import tabsRoutes from './routes/tabs.js';
import spacesRoutes from './routes/spaces.js';
import chatRoutes from './routes/chat.js';
import notionRoutes from './routes/notion.js';

const app = express();
const PORT = process.env.BACKEND_PORT || 3001;

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/tabs', tabsRoutes);
app.use('/api/spaces', spacesRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/notion', notionRoutes);

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
});

// Handle port already in use errors gracefully
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Killing existing process...`);
    // Try to find and kill the process using the port
    const { exec } = require('child_process');
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
  } else {
    throw err;
  }
});

