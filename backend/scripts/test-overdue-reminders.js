/**
 * Test script to manually trigger overdue task reminders
 * Run with: node backend/scripts/test-overdue-reminders.js
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { sendMorningTaskReminders } from '../services/notion-tasks-reminders.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: join(__dirname, '../../.env') });

console.log('🧪 Testing overdue task reminders...\n');
console.log('Configuration:');
console.log('  NOTION_TASKS_REMINDER_ENABLED:', process.env.NOTION_TASKS_REMINDER_ENABLED);
console.log('  NOTION_API_KEY:', process.env.NOTION_API_KEY ? 'SET ✅' : 'NOT SET ❌');
console.log('  NOTION_TASKS_DATABASE_ID:', process.env.NOTION_TASKS_DATABASE_ID || 'NOT SET ❌');
console.log('');

try {
  const result = await sendMorningTaskReminders();
  
  if (result) {
    console.log('\n📈 Test Results:');
    console.log(`   Tasks processed: ${result.tasksProcessed}`);
    console.log(`   Reminders sent: ${result.remindersSent}`);
    console.log(`   Errors: ${result.errors}`);
    console.log(`   Duration: ${result.duration}s`);
  }
  
  console.log('\n✅ Test completed successfully');
  process.exit(0);
} catch (error) {
  console.error('\n❌ Error running test:');
  console.error(error);
  if (error.stack) {
    console.error('\nStack trace:');
    console.error(error.stack);
  }
  process.exit(1);
}

