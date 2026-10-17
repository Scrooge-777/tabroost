/**
 * Typed messaging helpers for communication between UI and Background Service Worker
 */

/**
 * Send a message to the background service worker and wait for response.
 * Retries once: the first message after an MV3 worker restart can race its startup.
 */
export async function sendBackgroundMessage(type, payload = {}, { retry = true } = {}) {
  try {
    return await sendOnce(type, payload);
  } catch (err) {
    const transient = /Receiving end does not exist|message port closed/i.test(err.message);
    if (retry && transient) {
      await new Promise((r) => setTimeout(r, 150));
      return sendOnce(type, payload);
    }
    throw err;
  }
}

function sendOnce(type, payload) {
  return new Promise((resolve, reject) => {
    const message = { type, ...payload };
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (response && response.error) {
        return reject(new Error(response.error));
      }
      resolve(response ? response.data : null);
    });
  });
}

/**
 * Register a listener for runtime messages
 */
export function onBackgroundMessage(handler) {
  const listener = (message, sender, sendResponse) => {
    handler(message, sender, sendResponse);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
