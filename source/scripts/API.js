// API.js - Centralized API call functions in one file
// All functions return promises that resolve to the API response data or throw errors

const API_BASE = 'https://an-leabharlann-ghealach.onrender.com';

// Helper function to get auth headers
function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

// Helper function for API requests
async function apiRequest(method, path, body = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
  };
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'API request failed');
  }
  return response;
}

// Register a new user
async function register(username, email, password) {
  return apiRequest('POST', '/register', { username, email, password });
}

// Login user
async function login(username, password) {
  return apiRequest('POST', '/login', { username, password });
}

// Refresh token
async function refresh(refreshToken) {
  return apiRequest('POST', '/refresh', { refreshToken });
}

// Create a new node
const displayNameConfig = {
  Text: {
    primary: ['title', 'name'], // Try title first, then name
    secondary: 'publication_date' // Combine with publication_date
  },
  Edition: {
    primary: ['title', 'name'],
    secondary: 'publication_date'
  },
  Issue: {
    primary: ['title', 'name'],
    secondary: ['volume', 'issue', 'number']
  }
};
async function createNode(labels, properties) {
  // Generate display_name for applicable labels
  const updatedProperties = { ...properties };
  const applicableLabel = labels.find(label => displayNameConfig[label]);
  if (applicableLabel) {
    const config = displayNameConfig[applicableLabel];
    const primaryProp = config.primary.find(prop => properties[prop]);
    const secondaryProp = config.secondary;
    if (primaryProp && properties[primaryProp]) {
      const primaryValue = properties[primaryProp];
      const secondaryValue = properties[secondaryProp] || '';
      updatedProperties.display_name = secondaryValue
        ? `${primaryValue} (${secondaryValue})`
        : primaryValue;
    }
  }
  return apiRequest('POST', '/nodes', { labels, updatedProperties });
}

// Get a node by ID
async function getNode(id) {
  return apiRequest('GET', `/nodes/${encodeURIComponent(id)}`);
}

// Update a node's properties
async function updateNode(id, properties) {
  return apiRequest('PUT', `/nodes/${encodeURIComponent(id)}`, { properties });
}

// Delete a node
async function deleteNode(id) {
  return apiRequest('DELETE', `/nodes/${encodeURIComponent(id)}`);
}

// Delete a property from a node
async function deleteProperty(id, key) {
  return apiRequest('DELETE', `/nodes/${encodeURIComponent(id)}/property/${encodeURIComponent(key)}`);
}

// Get relations for a node
async function getRelations(id) {
  return apiRequest('GET', `/nodes/${encodeURIComponent(id)}/relations`);
}

// Create a relation
async function createRelation(sourceNodeId, targetNodeId, relType) {
  return apiRequest('POST', '/relation', { sourceNodeId, targetNodeId, relType });
}

// Delete a relation
async function deleteRelation(sourceNodeId, targetNodeId, relType) {
  return apiRequest('DELETE', '/relation', { sourceNodeId, targetNodeId, relType });
}

// Search the database
async function search(query) {
  return apiRequest('GET', `/search?query=${encodeURIComponent(query)}`);
}

async function searchWithLabel(query, nodeLabel) {
    return apiRequest('GET', `/search?label=${encodeURIComponent(nodeLabel)}&query=${encodeURIComponent(query)}`);
}