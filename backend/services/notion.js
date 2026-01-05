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
        // NOTION: "Parent item" can be multi-select, so we need to get ALL parents
        let parentNotionPageIds = [];
        if (page.properties) {
          // Check common parent property names - prioritize "Parent item" as mentioned by user
          const parentPropNames = ['Parent item', 'Parent Item', 'Parent', 'Parent ...', 'parent', 'Parent_id'];
          for (const propName of parentPropNames) {
            if (page.properties[propName] && page.properties[propName].type === 'relation') {
              const relation = page.properties[propName].relation;
              if (relation && relation.length > 0) {
                // Get ALL parent IDs (multi-select relation)
                parentNotionPageIds = relation.map(r => r.id);
                break;
              }
            }
          }
          // Also check any relation property that might be a parent (case-insensitive)
          if (parentNotionPageIds.length === 0) {
            for (const propName in page.properties) {
              const prop = page.properties[propName];
              if (prop.type === 'relation' && propName.toLowerCase().includes('parent')) {
                if (prop.relation && prop.relation.length > 0) {
                  // Get ALL parent IDs (multi-select relation)
                  parentNotionPageIds = prop.relation.map(r => r.id);
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

        // Get Tag property (multi_select property named "Tag")
        let tags = [];
        if (page.properties && page.properties.Tag) {
          const tagProp = page.properties.Tag;
          if (tagProp.type === 'multi_select' && tagProp.multi_select) {
            tags = tagProp.multi_select.map(item => item.name);
          }
        }

        // Get icon from page (icon can be emoji, file, or external)
        let iconData = { type: null, emoji: null, url: null };
        if (page.icon) {
          if (page.icon.type === 'emoji' && page.icon.emoji) {
            iconData = { type: 'emoji', emoji: page.icon.emoji, url: null };
          } else if ((page.icon.type === 'file' || page.icon.type === 'external') && page.icon[page.icon.type]) {
            const iconUrl = page.icon[page.icon.type].url || null;
            iconData = { type: page.icon.type, emoji: null, url: iconUrl };
          }
        }

        // Normalize page ID (remove hyphens for URL)
        const normalizedId = page.id.replace(/-/g, '');
        const pageUrl = page.url || `https://notion.so/${normalizedId}`;

        allPages.push({
          id: page.id,
          url: pageUrl,
          name: pageName,
          archived: isArchived,
          parent_id: parentNotionPageIds.length > 0 ? parentNotionPageIds[0] : null, // For backward compatibility, store first parent
          parent_ids: parentNotionPageIds, // Store ALL parent notion page IDs for mapping
          tags: tags, // Store tags array
          icon: iconData // Store icon data
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
 * Get current parents from Notion page
 * @param {string} apiKey - Notion API key
 * @param {string} pageId - Notion page ID
 * @param {string} parentPropertyName - Name of the parent property (default: 'Parent item')
 * @returns {Promise<string[]>} Array of parent page IDs
 */
async function getNotionPageParents(apiKey, pageId, parentPropertyName = 'Parent item') {
  if (!apiKey || !pageId) {
    throw new Error('API key and page ID are required');
  }

  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
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
    const parentRelation = page.properties?.[parentPropertyName];
    
    if (parentRelation?.type === 'relation' && parentRelation.relation) {
      return parentRelation.relation.map(r => r.id);
    }
    
    return [];
  } catch (error) {
    console.error('[NOTION] Error getting page parents:', error);
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

/**
 * Add a parent to Notion page (preserves existing parents)
 * @param {string} apiKey - Notion API key
 * @param {string} pageId - Notion page ID to update
 * @param {string} parentPageId - Parent Notion page ID to add
 * @param {string} parentPropertyName - Name of the parent property (default: 'Parent item')
 */
async function addNotionPageParent(apiKey, pageId, parentPageId, parentPropertyName = 'Parent item') {
  if (!apiKey || !pageId || !parentPageId) {
    throw new Error('API key, page ID, and parent page ID are required');
  }

  try {
    // Get current parents
    const currentParents = await getNotionPageParents(apiKey, pageId, parentPropertyName);
    
    // Check if parent already exists
    if (currentParents.includes(parentPageId)) {
      console.log(`[NOTION] Parent ${parentPageId} already exists for page ${pageId}`);
      return;
    }
    
    // Add new parent to the list
    const updatedParents = [...currentParents, parentPageId];
    
    // Update Notion with all parents
    const properties = {
      [parentPropertyName]: {
        relation: updatedParents.map(id => ({ id }))
      }
    };

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

    console.log(`[NOTION] Added parent ${parentPageId} to page ${pageId}`);
    return await response.json();
  } catch (error) {
    console.error('[NOTION] Error adding page parent:', error);
    throw error;
  }
}

/**
 * Remove a parent from Notion page (preserves other parents)
 * @param {string} apiKey - Notion API key
 * @param {string} pageId - Notion page ID to update
 * @param {string} parentPageId - Parent Notion page ID to remove
 * @param {string} parentPropertyName - Name of the parent property (default: 'Parent item')
 */
async function removeNotionPageParent(apiKey, pageId, parentPageId, parentPropertyName = 'Parent item') {
  if (!apiKey || !pageId || !parentPageId) {
    throw new Error('API key, page ID, and parent page ID are required');
  }

  try {
    // Get current parents
    const currentParents = await getNotionPageParents(apiKey, pageId, parentPropertyName);
    
    // Remove the parent from the list
    const updatedParents = currentParents.filter(id => id !== parentPageId);
    
    // Update Notion with remaining parents
    const properties = {
      [parentPropertyName]: {
        relation: updatedParents.map(id => ({ id }))
      }
    };

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

    console.log(`[NOTION] Removed parent ${parentPageId} from page ${pageId}`);
    return await response.json();
  } catch (error) {
    console.error('[NOTION] Error removing page parent:', error);
    throw error;
  }
}

/**
 * Update tags in Notion page
 * @param {string} apiKey - Notion API key
 * @param {string} pageId - Notion page ID
 * @param {string[]} tags - Array of tag names
 */
async function updateNotionPageTags(apiKey, pageId, tags) {
  if (!apiKey || !pageId) {
    throw new Error('API key and page ID are required');
  }

  try {
    // Convert array of tag names to Notion multi_select format
    const multiSelect = (tags || []).map(tagName => ({
      name: tagName
    }));

    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_API_VERSION
      },
      body: JSON.stringify({
        properties: {
          'Tag': {
            multi_select: multiSelect
          }
        }
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Notion API error: ${errorData.message || response.statusText}`);
    }

    console.log(`Notion page ${pageId} tags updated to:`, tags);
    return await response.json();
  } catch (error) {
    console.error('Error updating Notion page tags:', error);
    throw error;
  }
}

/**
 * Get page icon from Notion
 * @param {string} apiKey - Notion API key
 * @param {string} pageId - Notion page ID
 * @returns {Promise<{type: 'emoji'|'file'|'external'|null, emoji: string|null, url: string|null}>}
 */
async function getNotionPageIcon(apiKey, pageId) {
  if (!apiKey || !pageId) {
    throw new Error('API key and page ID are required');
  }

  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
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
    
    // Notion page icon can be:
    // - { type: 'emoji', emoji: '🎯' }
    // - { type: 'file', file: { url: '...', expiry_time: '...' } }
    // - { type: 'external', external: { url: '...' } }
    // - null (no icon)
    
    if (!page.icon) {
      return { type: null, emoji: null, url: null };
    }

    if (page.icon.type === 'emoji') {
      return {
        type: 'emoji',
        emoji: page.icon.emoji,
        url: null
      };
    } else if (page.icon.type === 'file') {
      return {
        type: 'file',
        emoji: null,
        url: page.icon.file?.url || null
      };
    } else if (page.icon.type === 'external') {
      return {
        type: 'external',
        emoji: null,
        url: page.icon.external?.url || null
      };
    }

    return { type: null, emoji: null, url: null };
  } catch (error) {
    console.error('Error getting Notion page icon:', error);
    throw error;
  }
}

export {
  createNotionPage,
  updateNotionPageName,
  archiveNotionPage,
  queryNotionPages,
  updateNotionPageParent,
  getNotionPageIcon,
  updateNotionPageTags,
  getNotionPageParents,
  addNotionPageParent,
  removeNotionPageParent,
};

