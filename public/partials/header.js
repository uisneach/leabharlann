function updateProfileMenu(username) {
  const profileMenu = document.getElementById('profileMenu');
  const navItem = profileMenu.parentElement;
  profileMenu.textContent = username;
  profileMenu.classList.add('dropdown-toggle');
  profileMenu.setAttribute('data-bs-toggle', 'dropdown');
  const existingDropdown = navItem.querySelector('.dropdown-menu');
  if (existingDropdown) existingDropdown.remove();
  const dropdown = document.createElement('ul');
  dropdown.className = 'dropdown-menu dropdown-menu-end';
  const logoutItem = document.createElement('li');
  const logoutLink = document.createElement('a');
  logoutLink.className = 'dropdown-item';
  logoutLink.href = '#';
  logoutLink.textContent = 'Log out';
  logoutLink.addEventListener('click', e => {
    e.preventDefault();
    localStorage.removeItem('token');
    profileMenu.textContent = 'Account';
    profileMenu.classList.remove('dropdown-toggle');
    profileMenu.removeAttribute('data-bs-toggle');
    navItem.querySelector('.dropdown-menu')?.remove();
  });
  logoutItem.appendChild(logoutLink);
  dropdown.appendChild(logoutItem);
  navItem.appendChild(dropdown);
}

function checkAuthStatus() {
  const token = localStorage.getItem('token');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      updateProfileMenu(payload.username || 'User');
    } catch (e) {
      console.error('Invalid token:', e);
      localStorage.removeItem('token');
    }
  }
}

document.getElementById('profileMenu')?.addEventListener('click', e => {
  console.log('click');
  e.preventDefault();
  if (!localStorage.getItem('token')) {
    new bootstrap.Modal(document.getElementById('loginModal')).show();
  }
});

document.getElementById('loginForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errorMessage = document.getElementById('errorMessage');
  if (!username || !password) {
    errorMessage.style.display = 'block';
    errorMessage.textContent = 'Please fill in all fields';
    return;
  }
  try {
    const response = await fetch(`https://an-leabharlann-ghealach.onrender.com/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username,
        password
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Login failed');
    localStorage.setItem('token', data.token);
    errorMessage.style.display = 'none';
    bootstrap.Modal.getInstance(document.getElementById('loginModal')).hide();
    updateProfileMenu(username);
  } catch (error) {
    errorMessage.style.display = 'block';
    errorMessage.textContent = error.message;
  }
});

document.getElementById('search-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const q = document.getElementById('search-input').value.trim();
  if (q) window.location = `info.html?type=authors&value=${encodeURIComponent(q)}`;
});

window.addEventListener('DOMContentLoaded', checkAuthStatus);