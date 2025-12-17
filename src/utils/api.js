import { config } from './config.js';

const TOKEN_KEY = 'dogeub_token';
const USER_KEY = 'dogeub_user';

class Api {
  constructor() {
    // Always use relative URLs - the proxy in server.js handles routing to backend
    this.baseUrl = '';
  }

  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  }

  getUser() {
    const user = localStorage.getItem(USER_KEY);
    return user ? JSON.parse(user) : null;
  }

  setUser(user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  isAuthenticated() {
    return !!this.getToken();
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const token = this.getToken();
    
    const headers = {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers
    };

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include'
    });

    const contentType = response.headers.get('content-type');
    const text = await response.text();
    
    let data;
    if (text && contentType && contentType.includes('application/json')) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error('JSON parse error:', e, 'Response text:', text);
        throw new Error('Invalid response from server');
      }
    } else if (text) {
      throw new Error(text || 'Request failed');
    } else {
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      data = {};
    }

    if (!response.ok) {
      throw new Error(data.error || `Request failed with status ${response.status}`);
    }

    return data;
  }

  // Auth
  async login(email, password) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    this.setToken(data.token);
    this.setUser(data.user);
    return data;
  }

  async register(email, password, name) {
    const data = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name })
    });
    this.setToken(data.token);
    this.setUser(data.user);
    return data;
  }

  async getCurrentUser() {
    return this.request('/api/auth/me');
  }

  async updateProfile(data) {
    return this.request('/api/users/me', {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  // Users
  async getUsers() {
    return this.request('/api/users');
  }

  async searchUsers(query) {
    return this.request(`/api/users/search?q=${encodeURIComponent(query)}`);
  }

  async deleteUser(userId) {
    return this.request(`/api/users/${userId}`, {
      method: 'DELETE'
    });
  }

  // Tabs (bookmarks)
  async getTabs() {
    return this.request('/api/tabs');
  }

  async createTab(data) {
    return this.request('/api/tabs', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updateTab(id, data) {
    return this.request(`/api/tabs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  async deleteTab(id) {
    return this.request(`/api/tabs/${id}`, {
      method: 'DELETE'
    });
  }

  async reorderTabs(updates) {
    return this.request('/api/tabs/reorder', {
      method: 'POST',
      body: JSON.stringify({ updates })
    });
  }

  // Spaces
  async getSpaces(category) {
    const query = category ? `?category=${category}` : '';
    return this.request(`/api/spaces${query}`);
  }

  async getSpace(id) {
    return this.request(`/api/spaces/${id}`);
  }

  async createSpace(data) {
    return this.request('/api/spaces', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updateSpace(id, data) {
    return this.request(`/api/spaces/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  async deleteSpace(id) {
    return this.request(`/api/spaces/${id}`, {
      method: 'DELETE'
    });
  }

  async reorderSpaces(spaceId, targetId, position, targetParentId) {
    return this.request('/api/spaces/reorder', {
      method: 'POST',
      body: JSON.stringify({ spaceId, targetId, position, targetParentId })
    });
  }

  // Chat
  async getChatForSpace(spaceId) {
    return this.request(`/api/chat/space/${spaceId}`);
  }

  async getMessages(chatId, options = {}) {
    let query = `?limit=${options.limit || 50}`;
    if (options.before) {
      query += `&before=${options.before}`;
    }
    return this.request(`/api/chat/${chatId}/messages${query}`);
  }

  async sendMessage(chatId, message) {
    return this.request(`/api/chat/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message })
    });
  }

  // Archive space
  async archiveSpace(spaceId, archived = true) {
    return this.request(`/api/spaces/${spaceId}/archive`, {
      method: 'PATCH',
      body: JSON.stringify({ archived })
    });
  }

  // Notion config
  async getNotionConfig() {
    return this.request('/api/notion/config');
  }

  async saveNotionConfig(config) {
    return this.request('/api/notion/config', {
      method: 'POST',
      body: JSON.stringify(config)
    });
  }

  // Supabase config for realtime
  async getSupabaseConfig() {
    return this.request('/api/users/supabase-config');
  }

  // Project Members
  async getProjectMembers(spaceId) {
    return this.request(`/api/chat/space/${spaceId}/members`);
  }

  async addProjectMembers(spaceId, userIds) {
    return this.request(`/api/chat/space/${spaceId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userIds })
    });
  }

  async removeProjectMembers(spaceId, userIds) {
    return this.request(`/api/chat/space/${spaceId}/members`, {
      method: 'DELETE',
      body: JSON.stringify({ userIds })
    });
  }
}

export default new Api();

