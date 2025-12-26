/**
 * Notion API Service
 * Handles all Notion API interactions for syncing projects/spaces
 */

const NOTION_API_VERSION = '2022-06-28';

/**
 * Create a page in Notion database
 * @param {string} apiKey - Notion API key
 * @param {string} databaseId - Notion database ID
 * @param {string} pageName - Name for the page (project name)
 * @returns {Promise<{id: string, url: string}>}
 */
async function createNotionPage(apiKey, databaseId, pageName) {
  if (!apiKey || !databaseId || !pageName) {
    throw new Error('API key, database ID, and page name are required');
  }

  try {
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_API_VERSION
      },
      body: JSON.stringify({
        parent: {
          database_id: databaseId,
        },
        properties: {
          'Name': {
            title: [
              {
                text: {
                  content: pageName,
                },
              },
            ],
          },
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Notion API error: ${errorData.message || response.statusText}`);
    }

    const data = await response.json();
    
    // Normalize page ID (remove hyphens for URL)
    const normalizedId = data.id.replace(/-/g, '');
    const pageUrl = data.url || `https://notion.so/${normalizedId}`;

    return {
      id: data.id,
      url: pageUrl
    };
  } catch (error) {
    console.error('Error creating Notion page:', error);
    throw error;
  }
}

/**
 * Update page name in Notion
 * @param {string} apiKey - Notion API key
 * @param {string} pageId - Notion page ID
 * @param {string} newName - New name for the page
 */
async function updateNotionPageName(apiKey, pageId, newName) {
  if (!apiKey || !pageId || !newName) {
    throw new Error('API key, page ID, and new name are required');
  }

  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_API_VERSION
      },
      body: JSON.stringify({
        properties: {
          'Name': {
            title: [
              {
                text: {
                  content: newName,
                },
              },
            ],
          },
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Notion API error: ${errorData.message || response.statusText}`);
    }

    console.log(`Notion page ${pageId} name updated to: ${newName}`);
  } catch (error) {
    console.error('Error updating Notion page name:', error);
    throw error;
  }
}

/**
 * Query all pages from a Notion database
 * @param {string} apiKey - Notion API key
 * @param {string} databaseId - Notion database ID
 * @returns {Promise<Array<{id: string, url: string, name: string, archived: boolean}>>}
 */
async function queryNotionPages(apiKey, databaseId) {
  if (!apiKey || !databaseId) {
    throw new Error('API key and database ID are required');
  }

  try {
    const allPages = [];
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
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Notion API error: ${errorData.message || response.statusText}`);
      }

      const data = await response.json();

      // Extract page info from results
      for (const page of data.results || []) {
        // Get page name from properties (usually in 'Name' property)
        let pageName = 'Untitled';
        if (page.properties && page.properties.Name && page.properties.Name.title) {
          const titleArray = page.properties.Name.title;
          if (titleArray.length > 0 && titleArray[0].text) {
            pageName = titleArray[0].text.content;
          }
        } else if (page.properties) {
          // Try to find any title property
          for (const propName in page.properties) {
            const prop = page.properties[propName];
            if (prop.type === 'title' && prop.title && prop.title.length > 0) {
              pageName = prop.title[0].text.content;
              break;
            }
          }
        }

        // Get parent_id from relation property (look for "Parent item", "Parent", or similar)
        let parentNotionPageId = null;
        if (page.properties) {
          // Check common parent property names - prioritize "Parent item" as mentioned by user
          const parentPropNames = ['Parent item', 'Parent Item', 'Parent', 'Parent ...', 'parent', 'Parent_id'];
          for (const propName of parentPropNames) {
            if (page.properties[propName] && page.properties[propName].type === 'relation') {
              const relation = page.properties[propName].relation;
              if (relation && relation.length > 0) {
                parentNotionPageId = relation[0].id;
                break;
              }
            }
          }
          // Also check any relation property that might be a parent (case-insensitive)
          if (!parentNotionPageId) {
            for (const propName in page.properties) {
              const prop = page.properties[propName];
              if (prop.type === 'relation' && propName.toLowerCase().includes('parent')) {
                if (prop.relation && prop.relation.length > 0) {
                  parentNotionPageId = prop.relation[0].id;
                  break;
                }
              }
            }
          }
        }

        // Get Archive property (checkbox property named "Archive")
        let isArchived = false;
        if (page.properties && page.properties.Archive) {
          const archiveProp = page.properties.Archive;
          if (archiveProp.type === 'checkbox') {
            isArchived = archiveProp.checkbox || false;
          } else if (archiveProp.type === 'select') {
            // If it's a select property, check if it has a value that indicates archived
            isArchived = archiveProp.select !== null && archiveProp.select !== undefined;
          }
        }
        // Fallback to page.archived if Archive property doesn't exist
        if (!page.properties || !page.properties.Archive) {
          isArchived = page.archived || false;
        }

        // Normalize page ID (remove hyphens for URL)
        const normalizedId = page.id.replace(/-/g, '');
        const pageUrl = page.url || `https://notion.so/${normalizedId}`;

        allPages.push({
          id: page.id,
          url: pageUrl,
          name: pageName,
          archived: isArchived,
          parent_id: parentNotionPageId // Store parent notion page ID for mapping
        });
      }

      hasMore = data.has_more || false;
      startCursor = data.next_cursor || null;
    }

    return allPages;
  } catch (error) {
    console.error('Error querying Notion pages:', error);
    throw error;
  }
}

/**
 * Archive a page in Notion
 * @param {string} apiKey - Notion API key
 * @param {string} pageId - Notion page ID
 * @param {boolean} archived - Archive status (true to archive, false to unarchive)
 */
async function archiveNotionPage(apiKey, pageId, archived = true) {
  if (!apiKey || !pageId) {
    throw new Error('API key and page ID are required');
  }

  try {
    // Archive/unarchive the page using the archived field directly
    // Note: Notion API only supports archiving, not permanent deletion
    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_API_VERSION
      },
      body: JSON.stringify({
        archived: Boolean(archived)
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Notion API error: ${errorData.message || response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error archiving Notion page:', error);
    throw error;
  }
}

/**
 * Update parent relation in Notion page
 * @param {string} apiKey - Notion API key
 * @param {string} pageId - Notion page ID to update
 * @param {string|null} parentPageId - Parent Notion page ID (null to remove parent)
 * @param {string} parentPropertyName - Name of the parent property (default: 'Parent item')
 */
async function updateNotionPageParent(apiKey, pageId, parentPageId, parentPropertyName = 'Parent item') {
  if (!apiKey || !pageId) {
    throw new Error('API key and page ID are required');
  }

  try {
    const properties = {};
    
    if (parentPageId) {
      // Set parent relation
      properties[parentPropertyName] = {
        relation: [
          {
            id: parentPageId
          }
        ]
      };
    } else {
      // Remove parent relation (set to empty array)
      properties[parentPropertyName] = {
        relation: []
      };
    }

    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_API_VERSION
      },
      body: JSON.stringify({
        properties
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Notion API error: ${errorData.message || response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[NOTION] Error updating page parent:', error);
    throw error;
  }
}

export {
  createNotionPage,
  updateNotionPageName,
  archiveNotionPage,
  queryNotionPages,
  updateNotionPageParent,
};

