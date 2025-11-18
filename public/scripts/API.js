// API.js - Centralized API call functions in one file
// All functions return promises that resolve to the API response data or throw errors

const API_BASE = 'https://an-leabharlann-ghealach.onrender.com';

// Helper function to show timed alert
function showTimedAlert(message, type = 'danger') {
  const alertDiv = document.createElement('div');
  alertDiv.className = `alert alert-${type} alert-dismissible position-fixed top-0 start-50 translate-middle-x mt-3`;
  alertDiv.role = 'alert';

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn-close';
  closeBtn.setAttribute('data-bs-dismiss', 'alert');
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.style.fontSize = '0.8rem';
  closeBtn.style.opacity = '0.5';
  closeBtn.style.position = 'absolute';
  closeBtn.style.top = '0.25rem';
  closeBtn.style.right = '0.25rem';
  closeBtn.style.padding = '0';
  alertDiv.appendChild(closeBtn);

  // Message
  const messageDiv = document.createElement('div');
  messageDiv.textContent = message;
  alertDiv.appendChild(messageDiv);

  // Timer bar (progress bar)
  const progress = document.createElement('div');
  progress.className = 'progress mt-2';
  progress.style.height = '4px';
  const progressBar = document.createElement('div');
  progressBar.className = 'progress-bar bg-secondary';
  progressBar.style.width = '100%';
  progressBar.style.transition = 'width 5s linear';
  progress.appendChild(progressBar);
  alertDiv.appendChild(progress);

  document.body.appendChild(alertDiv);

  // Trigger Bootstrap alert (if Bootstrap is loaded)
  if (typeof bootstrap !== 'undefined' && bootstrap.Alert) {
    new bootstrap.Alert(alertDiv);
  }

  // Start countdown animation
  setTimeout(() => {
    progressBar.style.width = '0%';
  }, 10);

  // Auto-remove after 8 seconds
  const timeoutId = setTimeout(() => {
    alertDiv.remove();
  }, 5000);

  // Clear timeout if manually closed
  alertDiv.addEventListener('closed.bs.alert', () => {
    clearTimeout(timeoutId);
  });
}


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
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message = errorData.error?.message || 'API request failed';
      throw new Error(message);
    }
    return response;
  } catch (error) {
    showTimedAlert(error.message || 'An unexpected error occurred');
    throw error;
  }
}

// Register a new user
async function register(username, password) {
  return apiRequest('POST', '/register', { username, password });
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
async function createNode(labels, rawProperties) {
  // Generate display_name for applicable labels
  const properties = { ...rawProperties };
  const applicableLabel = labels.find(label => displayNameConfig[label]);
  if (applicableLabel) {
    const config = displayNameConfig[applicableLabel];
    const primaryProp = config.primary.find(prop => rawProperties[prop]);
    const secondaryProp = config.secondary;
    if (primaryProp && rawProperties[primaryProp]) {
      const primaryValue = rawProperties[primaryProp];
      const secondaryValue = rawProperties[secondaryProp] || '';
      properties.display_name = secondaryValue
        ? `${primaryValue} (${secondaryValue})`
        : primaryValue;
    }
  }
  return apiRequest('POST', '/nodes', { labels, properties });
}

// Delete a node
async function deleteNode(id) {
  return apiRequest('DELETE', `/nodes/${encodeURIComponent(id)}`);
}

// Add a label to a node
async function addLabel(id, label) {
  return apiRequest('PUT', `/nodes/${encodeURIComponent(id)}/labels`, { label });
}

// Delete a label from a node
async function deleteLabel(id, label) {
  return apiRequest('DELETE', `/nodes/${encodeURIComponent(id)}/labels`, { label });
}

// Add a property to a node
async function addProperty(id, key, value) {
  return apiRequest('POST', `/nodes/${encodeURIComponent(id)}/properties`, { key, value });
}

// Change a property on a function
async function setProperty(id, key, value) {
  return apiRequest('PUT', `/nodes/${encodeURIComponent(id)}/properties`, { key, value });
}

async function setProperties(id, properties) {
  let results = [];
  for (let [key, value] in properties)
    results.push(apiRequest('PUT', `/nodes/${encodeURIComponent(id)}/properties`, { key, value }));
  return results;
}

// Delete property from a node
async function deleteProperty(id, key) {
  return apiRequest('DELETE', `/nodes/${encodeURIComponent(id)}/properties`, { key });
}

// Get relations for a node
async function getRelations(id) {
  return apiRequest('GET', `/nodes/${encodeURIComponent(id)}/relations`);
}

// Get a node by ID
async function getNode(id) {
  return apiRequest('GET', `/nodes/${encodeURIComponent(id)}`);
}

// Create a relation
async function createRelation(sourceNodeId, targetNodeId, relType) {
  return apiRequest('POST', '/relation', { sourceNodeId, targetNodeId, relType });
}

// Delete a relation
async function deleteRelation(sourceNodeId, targetNodeId, relType) {
  return apiRequest('DELETE', '/relation', { sourceNodeId, targetNodeId, relType });
}

// Get list of labels
async function getLabels() {
  return apiRequest('GET', '/labels');
}

// Get all nodes with a given label
async function getNodesByLabel(label) {
  return apiRequest('GET', `/nodes?label=${encodeURIComponent(label)}&limit=100`);
}

// Search the database
async function search(query) {
  return apiRequest('GET', `/search?query=${encodeURIComponent(query)}`);
}

async function searchWithLabel(query, nodeLabel) {
    return apiRequest('GET', `/search?label=${encodeURIComponent(nodeLabel)}&query=${encodeURIComponent(query)}`);
}