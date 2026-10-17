/**
 * Async wrapper around chrome.storage.local and chrome.storage.session
 */

export const storage = {
  // Local storage (persistent across restarts)
  async getLocal(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (items) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve(items);
      });
    });
  },

  async setLocal(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve();
      });
    });
  },

  async removeLocal(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve();
      });
    });
  },

  async clearLocal() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.clear(() => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve();
      });
    });
  },

  // Session storage (persists through SW sleep, wiped on browser exit)
  async getSession(keys) {
    return new Promise((resolve, reject) => {
      if (!chrome.storage.session) {
        return resolve({});
      }
      chrome.storage.session.get(keys, (items) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve(items || {});
      });
    });
  },

  async setSession(items) {
    return new Promise((resolve, reject) => {
      if (!chrome.storage.session) {
        return resolve();
      }
      chrome.storage.session.set(items, () => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve();
      });
    });
  },

  async removeSession(keys) {
    return new Promise((resolve, reject) => {
      if (!chrome.storage.session) {
        return resolve();
      }
      chrome.storage.session.remove(keys, () => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve();
      });
    });
  },

  async clearSession() {
    return new Promise((resolve, reject) => {
      if (!chrome.storage.session) {
        return resolve();
      }
      chrome.storage.session.clear(() => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve();
      });
    });
  }
};
