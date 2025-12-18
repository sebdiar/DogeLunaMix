/**
 * Notion Tasks Reminders Service
 * Handles daily reminders for tasks that are due today
 */

import supabase from '../config/database.js';
import { queryTasksByDueDate } from './notion-tasks.js';
import { getOrCreateChatForSpace } from '../routes/chat.js';

/**
 * Send morning reminders for tasks that are due today
 */
export async function sendMorningTaskReminders() {
  try {
    const apiKey = process.env.NOTION_API_KEY;
    const tasksDatabaseId = process.env.NOTION_TASKS_DATABASE_ID;
    const reminderEnabled = process.env.NOTION_TASKS_REMINDER_ENABLED === 'true';

    if (!reminderEnabled) {
      console.log('Task reminders are disabled');
      return;
    }

    if (!apiKey || !tasksDatabaseId) {
      console.log('Notion API key or tasks database ID not configured, skipping reminders');
      return;
    }

    // Get today's date in YYYY-MM-DD format
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    console.log(`🔔 Checking for tasks due today (${todayStr})...`);

    // Query tasks that are due today
    const tasks = await queryTasksByDueDate(apiKey, tasksDatabaseId, todayStr);

    if (!tasks || tasks.length === 0) {
      console.log('No tasks due today');
      return;
    }

    console.log(`Found ${tasks.length} task(s) due today`);

    let remindersSent = 0;
    let errors = 0;

    // Process each task
    for (const task of tasks) {
      try {
        // Skip tasks without project relation
        if (!task.projectId) {
          console.log(`Task "${task.title}" has no project relation, skipping`);
          continue;
        }

        // Find project by notion_page_id
        // Note: A task might be related to projects owned by different users
        // We need to send reminders to all projects with this notion_page_id
        const { data: projects, error: projectError } = await supabase
          .from('spaces')
          .select('id, name, user_id')
          .eq('notion_page_id', task.projectId)
          .eq('category', 'project');

        if (projectError || !projects || projects.length === 0) {
          console.log(`Project with Notion ID ${task.projectId} not found for task "${task.title}"`);
          continue;
        }

        // Send reminder to each project's chat
        for (const project of projects) {
          try {
            // Get or create chat for the project
            const chatId = await getOrCreateChatForSpace(project.id, project.user_id);

            if (!chatId) {
              console.error(`Failed to get or create chat for project: ${project.id}`);
              continue;
            }

            // Build reminder message
            let messageText = `Recordatorio: ${task.title} vence hoy`;
            
            if (task.assignee) {
              messageText += `\nAsignado: ${task.assignee}`;
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
              console.error(`Error sending reminder for task "${task.title}" to project "${project.name}":`, messageError);
              errors++;
            } else {
              console.log(`✅ Reminder sent for task "${task.title}" to project "${project.name}"`);
              remindersSent++;
            }
          } catch (error) {
            console.error(`Error processing reminder for task "${task.title}" in project "${project.name}":`, error);
            errors++;
          }
        }
      } catch (error) {
        console.error(`Error processing task "${task.title}":`, error);
        errors++;
      }
    }

    console.log(`📊 Reminders summary: ${remindersSent} sent, ${errors} errors`);
  } catch (error) {
    console.error('Error in sendMorningTaskReminders:', error);
    throw error;
  }
}

