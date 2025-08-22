function isUrl(s) {
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
}
window.isUrl = isUrl;


function cleanString(input) {
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
}
window.cleanString = cleanString;