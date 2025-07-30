async function insertHeader() {
  console.log("inserting")
  // Create header element
  const header = document.createElement('header');
  document.body.insertBefore(header, document.body.firstChild);

  // Fetch and insert header.html
  try {
    const response = await fetch('partials/header.html');
    if (!response.ok) throw new Error('Failed to load header');
    header.innerHTML = await response.text();
  } catch (error) {
    console.error('Error loading header:', error);
    header.innerHTML = '<p class="text-danger">Failed to load header</p>';
    return;
  }
}

window.addEventListener('DOMContentLoaded', insertHeader);