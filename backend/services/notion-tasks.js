/**
 * Notion Tasks API Service
 * Handles all Notion API interactions for tasks
 */

const NOTION_API_VERSION = '2022-06-28';

/**
 * Get task details from Notion
 * @param {string} apiKey - Notion API key
 * @param {string} taskId - Notion task page ID
 * @returns {Promise<{id: string, title: string, assignee: string|null, dueDate: string|null, projectId: string|null}>}
 */
async function getTaskDetails(apiKey, taskId) {
  if (!apiKey || !taskId) {
    throw new Error('API key and task ID are required');
  }

  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': NOTION_API_VERSION
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Notion API error: ${errorData.message || response.statusText}`);
    }

    const page = await response.json();

    // Log page properties for debugging
    console.log('📄 Task page properties:', Object.keys(page.properties || {}));

    // Extract title
    let title = 'Untitled';
    if (page.properties) {
      // Try to find title property (usually 'Name', 'Task', or first title property)
      if (page.properties.Name && page.properties.Name.title) {
        const titleArray = page.properties.Name.title;
        if (titleArray.length > 0 && titleArray[0].text) {
          title = titleArray[0].text.content;
        }
      } else if (page.properties.Task && page.properties.Task.title) {
        const titleArray = page.properties.Task.title;
        if (titleArray.length > 0 && titleArray[0].text) {
          title = titleArray[0].text.content;
        }
      } else {
        // Try to find any title property
        for (const propName in page.properties) {
          const prop = page.properties[propName];
          if (prop.type === 'title' && prop.title && prop.title.length > 0) {
            title = prop.title[0].text.content;
            break;
          }
        }
      }
    }

    // Extract assignee (Person property)
    let assignee = null;
    if (page.properties) {
      // Try common assignee property names
      const assigneePropNames = ['User', 'Asignado', 'Assignee', 'Assigned to', 'Person', 'Responsible'];
      for (const propName of assigneePropNames) {
        if (page.properties[propName] && page.properties[propName].type === 'people') {
          const people = page.properties[propName].people;
          if (people && people.length > 0) {
            assignee = people[0].name || people[0].id;
            break;
          }
        }
      }
      // Fallback: check any people property
      if (!assignee) {
        for (const propName in page.properties) {
          const prop = page.properties[propName];
          if (prop.type === 'people' && prop.people && prop.people.length > 0) {
            assignee = prop.people[0].name || prop.people[0].id;
            break;
          }
        }
      }
    }

    // Extract due date (Date property)
    let dueDate = null;
    if (page.properties) {
      // Try common due date property names
      const dueDatePropNames = ['Due Date', 'Due', 'Fecha de vencimiento', 'Vence', 'Deadline', 'Date'];
      for (const propName of dueDatePropNames) {
        if (page.properties[propName] && page.properties[propName].type === 'date') {
          const date = page.properties[propName].date;
          if (date && date.start) {
            dueDate = date.start;
            break;
          }
        }
      }
      // Fallback: check any date property
      if (!dueDate) {
        for (const propName in page.properties) {
          const prop = page.properties[propName];
          if (prop.type === 'date' && prop.date && prop.date.start) {
            dueDate = prop.date.start;
            break;
          }
        }
      }
    }

    // Extract project relation (Relation property named "Project")
    let projectId = null;
    if (page.properties) {
      // Try "Project" property first (as specified by user)
      if (page.properties.Project && page.properties.Project.type === 'relation') {
        const relation = page.properties.Project.relation;
        if (relation && relation.length > 0) {
          projectId = relation[0].id;
          console.log('✅ Found Project relation:', projectId);
        }
      }
      // Fallback: check any relation property that might be a project
      if (!projectId) {
        console.log('🔍 Searching for relation properties...');
        for (const propName in page.properties) {
          const prop = page.properties[propName];
          console.log(`  - ${propName}: type=${prop.type}`);
          if (prop.type === 'relation' && propName.toLowerCase().includes('project')) {
            if (prop.relation && prop.relation.length > 0) {
              projectId = prop.relation[0].id;
              console.log(`✅ Found project relation in "${propName}":`, projectId);
              break;
            }
          }
        }
      }
    }
    
    if (!projectId) {
      console.log('⚠️  No project relation found in task properties');
    }

    // Extract done status (Checkbox property named "Done")
    let isDone = false;
    if (page.properties) {
      // Try common done property names
      const donePropNames = ['Done', 'Completado', 'Completed', 'Finished', 'Checkbox'];
      for (const propName of donePropNames) {
        if (page.properties[propName] && page.properties[propName].type === 'checkbox') {
          isDone = page.properties[propName].checkbox === true;
          break;
        }
      }
      // Fallback: check any checkbox property
      if (!isDone) {
        for (const propName in page.properties) {
          const prop = page.properties[propName];
          if (prop.type === 'checkbox' && propName.toLowerCase().includes('done')) {
            isDone = prop.checkbox === true;
            break;
          }
        }
      }
    }

    return {
      id: page.id,
      title,
      assignee,
      dueDate,
      projectId,
      isDone
    };
  } catch (error) {
    console.error('Error getting task details:', error);
    throw error;
  }
}

/**
 * Query tasks from Notion database by due date
 * @param {string} apiKey - Notion API key
 * @param {string} databaseId - Notion database ID
 * @param {string} dueDate - Date in YYYY-MM-DD format
 * @returns {Promise<Array<{id: string, title: string, assignee: string|null, dueDate: string|null, projectId: string|null}>>}
 */
async function queryTasksByDueDate(apiKey, databaseId, dueDate) {
  if (!apiKey || !databaseId || !dueDate) {
    throw new Error('API key, database ID, and due date are required');
  }

  try {
    const allTasks = [];
    let hasMore = true;
    let startCursor = null;

    while (hasMore) {
      const body = {
        page_size: 100,
        filter: {
          and: [
            {
              property: 'Due Date', // Try common property name
              date: {
                equals: dueDate
              }
            }
          ]
        }
      };

      if (startCursor) {
        body.start_cursor = startCursor;
      }

      const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Notion-Version': NOTION_API_VERSION
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json();
        // If filter fails, try without filter and filter in code
        if (errorData.code === 'validation_error') {
          // Try alternative approach: get all tasks and filter by date
          return await queryAllTasksAndFilterByDate(apiKey, databaseId, dueDate);
        }
        throw new Error(`Notion API error: ${errorData.message || response.statusText}`);
      }

      const data = await response.json();

      // Process each task
      for (const page of data.results || []) {
        const taskDetails = await getTaskDetails(apiKey, page.id);
        // Only include tasks that match the due date
        if (taskDetails.dueDate && taskDetails.dueDate.startsWith(dueDate)) {
          allTasks.push(taskDetails);
        }
      }

      hasMore = data.has_more || false;
      startCursor = data.next_cursor || null;
    }

    return allTasks;
  } catch (error) {
    console.error('Error querying tasks by due date:', error);
    throw error;
  }
}

/**
 * Fallback: Query all tasks and filter by date in code
 * Used when Notion filter doesn't work with the property name
 */
async function queryAllTasksAndFilterByDate(apiKey, databaseId, dueDate) {
  try {
    const allTasks = [];
    let hasMore = true;
    let startCursor = null;

    while (hasMore) {
      const body = {
        page_size: 100
      };

      if (startCursor) {
        body.start_cursor = startCursor;
      }

      const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Notion-Version': NOTION_API_VERSION
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Notion API error: ${errorData.message || response.statusText}`);
      }

      const data = await response.json();

      // Process each task and filter by date
      for (const page of data.results || []) {
        const taskDetails = await getTaskDetails(apiKey, page.id);
        // Check if due date matches (starts with the date string)
        if (taskDetails.dueDate && taskDetails.dueDate.startsWith(dueDate)) {
          allTasks.push(taskDetails);
        }
      }

      hasMore = data.has_more || false;
      startCursor = data.next_cursor || null;
    }

    return allTasks;
  } catch (error) {
    console.error('Error querying all tasks:', error);
    throw error;
  }
}

export {
  getTaskDetails,
  queryTasksByDueDate
};

