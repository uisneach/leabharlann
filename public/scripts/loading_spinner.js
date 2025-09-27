let __apiSpinnerCount = 0;

function _getSpinnerOverlay() {
  return document.getElementById('api-spinner-inside');
}

function showSpinner(message = 'Loading...') {
  const overlay = _getSpinnerOverlay();
  const msg = document.getElementById('api-spinner-message');
  if (msg) msg.textContent = message;
  __apiSpinnerCount++;
  if (overlay && overlay.getAttribute('aria-hidden') === 'true') {
    overlay.setAttribute('aria-hidden', 'false');
  }
}

function updateSpinnerMessage(message) {
  const msg = document.getElementById('api-spinner-message');
  if (msg) msg.textContent = message;
}

function hideSpinner() {
  // decrement but never below zero
  __apiSpinnerCount = Math.max(0, __apiSpinnerCount - 1);
  const overlay = _getSpinnerOverlay();
  if (overlay && __apiSpinnerCount === 0) {
    overlay.setAttribute('aria-hidden', 'true');
  }
}

const RETRY_STATUSES = [502, 503, 504, 524];
const MAX_RETRIES = 6;
const BASE_DELAY_MS = 1000;

async function fetchWithSpinner(fn, options = {}) {
  const maxRetries = (options.maxRetries != null) ? options.maxRetries : MAX_RETRIES;
  showSpinner('Loading...');
  try {
    let attempt = 0;
    while (true) {
      attempt++;
      try {
        const result = await fn();

        // If it's a Fetch Response-like object, inspect it
        if (result && typeof result.ok === 'boolean') {
          if (result.ok) {
            return result;
          } else {
            const status = result.status;
            if (RETRY_STATUSES.includes(status) && attempt < maxRetries) {
              const wait = BASE_DELAY_MS * Math.pow(2, attempt - 1);
              updateSpinnerMessage(`The API is spinning up — retrying (${attempt}/${maxRetries})...`);
              await delay(wait);
              continue;
            } else {
              let bodyText = '';
              try {
                bodyText = await result.text();
                if (bodyText && bodyText.length > 300) bodyText = bodyText.slice(0, 300) + '…';
              } catch (e) {
                bodyText = '';
              }
              throw new Error(`API returned ${status} ${result.statusText || ''}${bodyText ? ': ' + bodyText : ''}`);
            }
          }
        } else {
          // Not a Response — treat as success
          return result;
        }
      } catch (err) {
        const isNetworkError = err instanceof TypeError || /network|failed/i.test(String(err));
        if (isNetworkError && attempt < maxRetries) {
          updateSpinnerMessage(`The API is spinning up — retrying (${attempt}/${maxRetries})...`);
          const wait = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          await delay(wait);
          continue;
        } else {
          throw err;
        }
      }
    }
  } finally {
    hideSpinner();
  }
}