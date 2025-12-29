/**
 * Notion Tasks Reminders Service
 * Handles daily reminders for tasks that are due today
 */

import supabase from '../config/database.js';
import { queryOverdueTasks } from './notion-tasks.js';
import { getOrCreateChatForSpace, sendSystemMessageNotifications } from '../routes/chat.js';

/**
 * Send morning reminders for overdue tasks (tasks with due date before today)
 */
export async function sendMorningTaskReminders() {
  const startTime = new Date();

  try {
    const apiKey = process.env.NOTION_API_KEY;
    const tasksDatabaseId = process.env.NOTION_TASKS_DATABASE_ID;
    const reminderEnabled = process.env.NOTION_TASKS_REMINDER_ENABLED === 'true';

    if (!reminderEnabled) {
      console.log('⚠️  Task reminders are disabled');
      return;
    }

    if (!apiKey || !tasksDatabaseId) {
      console.log('⚠️  Notion API key or tasks database ID not configured, skipping reminders');
      return;
    }

    // Query overdue tasks (tasks with due date before today and not completed)
    const tasks = await queryOverdueTasks(apiKey, tasksDatabaseId);

    if (!tasks || tasks.length === 0) {
      console.log('✅ No overdue tasks found');
      return;
    }

    console.log(`📊 Found ${tasks.length} overdue task(s)`);

    let remindersSent = 0;
    let errors = 0;

    // Process each task
    for (const task of tasks) {
      try {
        // Skip tasks without project relation
        if (!task.projectId) {
          continue;
        }

        // Find ALL projects by notion_page_id
        // Note: A task might be related to projects owned by different users
        // We need to send reminders to ALL projects with this notion_page_id
        const { data: projects, error: projectError } = await supabase
          .from('spaces')
          .select('id, name, user_id')
          .eq('notion_page_id', task.projectId)
          .eq('category', 'project');

        if (projectError || !projects || projects.length === 0) {
          continue;
        }

        // Send reminder to each project's chat
        for (const project of projects) {
          try {
            // Get or create chat for the project
            const chatId = await getOrCreateChatForSpace(project.id, project.user_id);

            if (!chatId) {
              continue;
            }

            // Build reminder message for overdue task
            // Format due date
            const dueDate = new Date(task.dueDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            dueDate.setHours(0, 0, 0, 0);
            const diffTime = today - dueDate;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            let daysText = diffDays === 1 ? 'day' : 'days';
            let messageText = `✅ Reminder: ${task.title} is ${diffDays} ${daysText} overdue`;
            
            // Add formatted due date
            const formattedDueDate = dueDate.toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric', 
              year: 'numeric' 
            });
            messageText += `\n📅 Due: ${formattedDueDate}`;
            
            if (task.assignee) {
              messageText += `\n👤 Assigned: ${task.assignee}`;
            }

            // Send system message to chat
            const { error: messageError } = await supabase
              .from('chat_messages')
              .insert({
                chat_id: chatId,
                user_id: null, // null = system message
                message: messageText
              });

            if (messageError) {
              errors++;
            } else {
              // Send push notifications for system message (in background)
              setImmediate(async () => {
                await sendSystemMessageNotifications(chatId, messageText);
              });
              remindersSent++;
            }
          } catch (error) {
            errors++;
          }
        }
      } catch (error) {
        errors++;
      }
    }

    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 Reminders Summary:`);
    console.log(`   ✅ Successfully sent: ${remindersSent}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`   ⏱️  Duration: ${duration}s`);
    console.log(`   🕐 Completed at: ${endTime.toISOString()}`);
    console.log(`${'='.repeat(60)}\n`);

    return {
      success: true,
      remindersSent,
      errors,
      tasksProcessed: tasks.length,
      duration: parseFloat(duration)
    };
  } catch (error) {
    console.error('\n❌ Error in sendMorningTaskReminders:', error);
    console.error('Stack trace:', error.stack);
    throw error;
  }
}


