/**
 * Typed messaging helpers for communication between UI and Background Service Worker
 */

import { MESSAGE_TYPES } from './constants.js';

/**
 * Send a message to the background service worker and wait for response
 */
export async function sendBackgroundMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const message = { type, ...payload };
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        // Service worker might be waking up or closed
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
