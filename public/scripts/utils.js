window.isUrl = function isUrl(s) {
  if (typeof s !== 'string') return false;
  s = s.trim();
  if (s === '') return false;

  // quick reject: unencoded whitespace is almost never a valid absolute URL
  if (/\s/.test(s)) return false;

  try {
    const url = new URL(s);

    // allow only known protocols (add more if you want to accept them)
    const allowed = new Set(['http:', 'https:', 'ftp:', 'mailto:']);
    if (!allowed.has(url.protocol)) return false;

    // require a hostname for network protocols (http/https/ftp)
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ftp:') {
      return Boolean(url.hostname); // e.g. "http://example.com"
    }

    // for mailto we just check there's something after the scheme
    if (url.protocol === 'mailto:') {
      return url.pathname && url.pathname.length > 0;
    }

    return false;
  } catch (e) {
    return false;
  }
};


window.cleanString = function cleanString(input) {
  return (
    input
      // replace underscore or dash with space
      .replace(/[_-]+/g, ' ')
      // collapse multiple spaces
      .replace(/\s+/g, ' ')
      .trim()
      // capitalize first letter of each word
      .replace(/\b\w/g, (ch) => ch.toUpperCase())
  );
};


window.createDeleteButton = function(onclickHandler, payload = null, size = '20px', color = 'red') {
  const button = document.createElement('button');
  button.className = "btn btn-danger btn-sm delete-property-btn";
  button.setAttribute('aria-label', 'Delete');

  // Styling — minimal red circle with a horizontal bar
  button.style.position = 'relative';
  button.style.width = size;
  button.style.height = size;
  button.style.border = `2px solid ${color}`;
  button.style.borderRadius = '50%';
  button.style.background = 'transparent';
  button.style.cursor = 'pointer';
  button.style.overflow = 'hidden';

  const bar = document.createElement('span');
  bar.style.position = 'absolute';
  bar.style.top = '50%';
  bar.style.left = '15%';
  bar.style.width = '70%';
  bar.style.height = '2px';
  bar.style.background = color;
  bar.style.transform = 'translateY(-50%)';

  button.appendChild(bar);


  if (typeof onclickHandler === 'function') {
    button.addEventListener('click', function(ev) {
      ev.preventDefault();
      try {
        if (Array.isArray(payload)) {
          onclickHandler(...payload, { button, event: ev });
        } else {
          onclickHandler(payload, { button, event: ev });
        }
      } catch (err) {
        console.error('Error in delete handler:', err);
      }
    });
  }

  return button;
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}