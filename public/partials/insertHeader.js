async function insertHeader() {
  const header = document.createElement('header');
  document.body.insertBefore(header, document.body.firstChild);
  try {
    const response = await fetch('partials/header.html');
    if (!response.ok) throw new Error('Failed to load header');
    header.innerHTML = await response.text();
    // Execute scripts in header.html
    const scripts = header.querySelectorAll('script');
    scripts.forEach(script => {
      const newScript = document.createElement('script');
      newScript.textContent = script.textContent;
      document.head.appendChild(newScript);
    });
  } catch (error) {
    console.error('Error loading header:', error);
    header.innerHTML = '<p class="text-danger">Failed to load header</p>';
  }
}

window.addEventListener('DOMContentLoaded', insertHeader);