/**
 * Live Tabs View — the current window's open tabs, with drag-to-group, rename,
 * ungroup and collapse acting directly on the real tab strip.
 */

import { renderTabTree } from './tab-tree.js';
import { showNamePrompt, isNamePromptOpen } from './group-name-prompt.js';
import { showMenu } from './context-menu.js';
import { toastError } from './toast.js';
import { debounce } from '../../shared/utils.js';
import { nextUnusedColor } from '../../shared/colors.js';

const NONE = -1;

export class LiveTabsView {
  constructor(containerElement, { windowId, onTabCountChange } = {}) {
    this.container = containerElement;
    this.windowId = windowId;
    this.onTabCountChange = onTabCountChange || null;
    this.tabs = [];
    this.groups = [];
    this.active = false;
    this.pendingRender = false;
    this.refresh = debounce(() => this.loadAndRender(), 120);
    this.listen();
  }

  listen() {
    const forThisWindow = (windowId) => windowId === undefined || windowId === this.windowId;
    const onTab = (...args) => {
      const info = args.find((a) => a && typeof a === 'object' && ('windowId' in a || 'newWindowId' in a || 'oldWindowId' in a));
      if (!info || forThisWindow(info.windowId ?? info.newWindowId ?? info.oldWindowId)) this.refresh();
    };
    for (const evt of ['onCreated', 'onRemoved', 'onMoved', 'onAttached', 'onDetached', 'onActivated']) {
      chrome.tabs?.[evt]?.addListener(onTab);
    }
    chrome.tabs?.onUpdated?.addListener((id, change, tab) => {
      if (tab?.windowId !== this.windowId) return;
      if (change.title || change.favIconUrl || change.url || change.pinned !== undefined || change.groupId !== undefined || change.status === 'complete') {
        this.refresh();
      }
    });
    if (chrome.tabGroups) {
      for (const evt of ['onCreated', 'onUpdated', 'onRemoved', 'onMoved']) {
        chrome.tabGroups[evt]?.addListener((g) => forThisWindow(g?.windowId) && this.refresh());
      }
    }
  }

  setActive(active) {
    this.active = active;
    if (active) this.loadAndRender();
  }

  async loadAndRender() {
    if (!this.windowId || !chrome.tabs?.query) return;
    try {
      const [tabs, groups] = await Promise.all([
        chrome.tabs.query({ windowId: this.windowId }),
        chrome.tabGroups?.query ? chrome.tabGroups.query({ windowId: this.windowId }) : Promise.resolve([])
      ]);
      this.tabs = tabs || [];
      this.groups = groups || [];
      this.onTabCountChange?.(this.tabs.length);
      if (!this.active) return;
      if (isNamePromptOpen()) {
        this.pendingRender = true;
        return;
      }
      this.render();
    } catch (err) {
      console.warn('LiveTabsView: load error', err);
    }
  }

  render() {
    this.pendingRender = false;
    const scrollTop = this.container.parentElement?.scrollTop ?? 0;
    const tree = renderTabTree({
      tabs: this.tabs.map((t) => ({ ...t, url: t.url || t.pendingUrl })),
      groups: this.groups,
      workspaceId: null,
      live: true,
      isExpanded: (g) => !g.collapsed,
      on: {
        activate: (tab) => this.run(async () => {
          await chrome.tabs.update(tab.id, { active: true });
          await chrome.windows.update(this.windowId, { focused: true });
        }),
        close: (tab) => this.run(() => chrome.tabs.remove(tab.id)),
        ungroupTab: (tab) => this.run(() => chrome.tabs.ungroup([tab.id])),
        toggleGroup: (group, expanded) => this.run(() => chrome.tabGroups.update(group.id, { collapsed: !expanded })),
        editGroup: (group, anchor) => this.editGroup(group, anchor),
        ungroupAll: (group) => this.run(async () => {
          const ids = this.tabs.filter((t) => t.groupId === group.id).map((t) => t.id);
          if (ids.length) await chrome.tabs.ungroup(ids);
        }),
        dropOnTab: (data, target) => this.dropOnTab(data, target),
        dropOnGroup: (data, group) => this.run(async () => {
          const id = Number(data.tabId);
          await chrome.tabs.group({ tabIds: [id], groupId: group.id });
          await chrome.tabGroups.update(group.id, { collapsed: false }).catch(() => {});
        }),
        dropUngroup: (data) => this.run(() => chrome.tabs.ungroup([Number(data.tabId)])),
        tabMenu: (tab, group, x, y) => this.tabMenu(tab, group, x, y)
      }
    });
    tree.classList.add('is-live');
    this.container.replaceChildren(tree);
    if (this.container.parentElement) this.container.parentElement.scrollTop = scrollTop;
  }

  async run(fn) {
    try {
      await fn();
    } catch (err) {
      toastError(err, 'Could not update tabs');
    }
    this.refresh();
  }

  async dropOnTab(data, target) {
    if (!data.live) return;
    const draggedId = Number(data.tabId);
    await this.run(async () => {
      const dragged = await chrome.tabs.get(draggedId);
      const fresh = await chrome.tabs.get(target.id);
      if (fresh.groupId !== NONE) {
        await chrome.tabs.group({ tabIds: [draggedId], groupId: fresh.groupId });
        await chrome.tabs.move(draggedId, { index: fresh.index }).catch(() => {});
      } else if (dragged.groupId !== NONE) {
        await chrome.tabs.ungroup([draggedId]);
        await chrome.tabs.move(draggedId, { index: fresh.index }).catch(() => {});
      } else {
        const groupId = await chrome.tabs.group({ tabIds: [fresh.id, draggedId], createProperties: { windowId: this.windowId } });
        const color = nextUnusedColor(this.groups.map((g) => g.color));
        await chrome.tabGroups.update(groupId, { color, collapsed: false }).catch(() => {});
        await this.loadAndRender();
        const head = this.container.querySelector(`.group[data-group-id="${groupId}"] .group-head`);
        this.promptForGroup({ id: groupId, title: '', color }, head);
      }
    });
  }

  editGroup(group, anchor) {
    this.promptForGroup(group, anchor);
  }

  promptForGroup(group, anchor) {
    showNamePrompt({
      anchor,
      title: group.title,
      color: group.color,
      onCommit: async ({ title, color }) => {
        await this.run(() => chrome.tabGroups.update(group.id, { title, color }));
        if (this.pendingRender) this.render();
      }
    });
  }

  tabMenu(tab, group, x, y) {
    showMenu({
      x,
      y,
      label: 'Tab actions',
      items: [
        group ? { label: 'Remove from group', icon: 'popout', onSelect: () => this.run(() => chrome.tabs.ungroup([tab.id])) } : null,
        { label: tab.pinned ? 'Unpin tab' : 'Pin tab', icon: 'pin', onSelect: () => this.run(() => chrome.tabs.update(tab.id, { pinned: !tab.pinned })) },
        { label: 'Duplicate tab', icon: 'duplicate', onSelect: () => this.run(() => chrome.tabs.duplicate(tab.id)) },
        { label: 'Move to new window', icon: 'window', onSelect: () => this.run(() => chrome.windows.create({ tabId: tab.id, focused: true })) },
        { separator: true },
        { label: 'Close tab', icon: 'close', danger: true, onSelect: () => this.run(() => chrome.tabs.remove(tab.id)) }
      ]
    });
  }
}
