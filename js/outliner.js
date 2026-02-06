// Outliner Module - 階層化エディタ

let currentMemo = null;
let onChangeCallback = null;
let searchQuery = '';

// アウトライナー初期化
export function initOutliner(containerId, onChange) {
    onChangeCallback = onChange;
    const container = document.getElementById(containerId);
    container.addEventListener('keydown', handleKeyDown);
    container.addEventListener('input', handleInput);
    container.addEventListener('click', handleClick);
}

// メモをロード
export function loadMemo(memo) {
    currentMemo = memo;
    searchQuery = '';
    render();
}

// 現在のアイテムを取得
export function getItems() {
    return currentMemo ? currentMemo.items : [];
}

// 検索
export function searchInMemo(query) {
    searchQuery = query.toLowerCase();
    render();
}

// 新規アイテム追加
export function addItem() {
    if (!currentMemo) return;

    const newItem = {
        id: generateId(),
        content: '',
        children: [],
        collapsed: false
    };

    currentMemo.items.push(newItem);
    render();

    // 新しいアイテムにフォーカス
    setTimeout(() => {
        const el = document.querySelector(`[data-id="${newItem.id}"] .item-content`);
        if (el) el.focus();
    }, 10);

    triggerChange();
}

// レンダリング
function render() {
    const container = document.getElementById('outliner');
    if (!container || !currentMemo) return;

    if (currentMemo.items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="12" y1="18" x2="12" y2="12"/>
                    <line x1="9" y1="15" x2="15" y2="15"/>
                </svg>
                <p>右下の + ボタンで<br>項目を追加</p>
            </div>
        `;
        return;
    }

    container.innerHTML = renderItems(currentMemo.items, 0);
}

function renderItems(items, depth) {
    return items.map(item => renderItem(item, depth)).join('');
}

function renderItem(item, depth) {
    const hasChildren = item.children && item.children.length > 0;
    const isCollapsed = item.collapsed;
    const isHighlighted = searchQuery && item.content.toLowerCase().includes(searchQuery);

    const toggleIcon = hasChildren ? `
        <button class="toggle-btn has-children ${isCollapsed ? 'collapsed' : ''}" data-action="toggle" data-id="${item.id}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"/>
            </svg>
        </button>
    ` : '<span class="toggle-btn"></span>';

    const childrenHtml = hasChildren ? `
        <div class="item-children ${isCollapsed ? 'collapsed' : ''}" data-parent="${item.id}">
            ${renderItems(item.children, depth + 1)}
        </div>
    ` : '';

    return `
        <div class="outline-item ${isHighlighted ? 'highlight' : ''}" data-id="${item.id}" data-depth="${depth}">
            ${toggleIcon}
            <span class="bullet"></span>
            <div class="item-content" contenteditable="true" data-id="${item.id}">${escapeHtml(item.content)}</div>
        </div>
        ${childrenHtml}
    `;
}

// キーボードイベント
function handleKeyDown(e) {
    const target = e.target;
    if (!target.classList.contains('item-content')) return;

    const itemId = target.dataset.id;

    // Tab: インデント
    if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
            outdentItem(itemId);
        } else {
            indentItem(itemId);
        }
        return;
    }

    // Enter: 新規行
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        insertItemAfter(itemId);
        return;
    }

    // Backspace: 空なら削除
    if (e.key === 'Backspace' && target.textContent === '') {
        e.preventDefault();
        deleteItem(itemId);
        return;
    }
}

// 入力イベント
function handleInput(e) {
    const target = e.target;
    if (!target.classList.contains('item-content')) return;

    const itemId = target.dataset.id;
    const content = target.textContent;

    updateItemContent(itemId, content);
}

// クリックイベント
function handleClick(e) {
    const target = e.target.closest('[data-action="toggle"]');
    if (target) {
        const itemId = target.dataset.id;
        toggleItem(itemId);
    }
}

// アイテム操作
function findItem(items, id, parent = null, index = -1) {
    for (let i = 0; i < items.length; i++) {
        if (items[i].id === id) {
            return { item: items[i], parent, index: i, siblings: items };
        }
        if (items[i].children) {
            const found = findItem(items[i].children, id, items[i], i);
            if (found) return found;
        }
    }
    return null;
}

function updateItemContent(id, content) {
    const found = findItem(currentMemo.items, id);
    if (found) {
        found.item.content = content;
        triggerChange();
    }
}

function toggleItem(id) {
    const found = findItem(currentMemo.items, id);
    if (found) {
        found.item.collapsed = !found.item.collapsed;
        render();
        triggerChange();
    }
}

function indentItem(id) {
    const found = findItem(currentMemo.items, id);
    if (!found || found.index === 0) return;

    // 前のアイテムの子にする
    const prevItem = found.siblings[found.index - 1];
    if (!prevItem.children) prevItem.children = [];

    found.siblings.splice(found.index, 1);
    prevItem.children.push(found.item);
    prevItem.collapsed = false;

    render();
    focusItem(id);
    triggerChange();
}

function outdentItem(id) {
    const found = findItem(currentMemo.items, id);
    if (!found || !found.parent) return;

    // 親の兄弟にする
    const parentFound = findItem(currentMemo.items, found.parent.id);
    if (!parentFound) return;

    found.siblings.splice(found.index, 1);
    parentFound.siblings.splice(parentFound.index + 1, 0, found.item);

    render();
    focusItem(id);
    triggerChange();
}

function insertItemAfter(id) {
    const found = findItem(currentMemo.items, id);
    if (!found) return;

    const newItem = {
        id: generateId(),
        content: '',
        children: [],
        collapsed: false
    };

    found.siblings.splice(found.index + 1, 0, newItem);
    render();

    setTimeout(() => focusItem(newItem.id), 10);
    triggerChange();
}

function deleteItem(id) {
    const found = findItem(currentMemo.items, id);
    if (!found) return;

    // 最後の1つは削除しない
    if (currentMemo.items.length === 1 && !found.parent) return;

    const prevIndex = found.index - 1;
    found.siblings.splice(found.index, 1);

    render();

    // 前のアイテムにフォーカス
    if (prevIndex >= 0 && found.siblings[prevIndex]) {
        focusItem(found.siblings[prevIndex].id);
    } else if (found.parent) {
        focusItem(found.parent.id);
    }

    triggerChange();
}

function focusItem(id) {
    const el = document.querySelector(`[data-id="${id}"].item-content`);
    if (el) {
        el.focus();
        // カーソルを末尾に
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

function triggerChange() {
    if (onChangeCallback && currentMemo) {
        onChangeCallback(currentMemo.items);
    }
}

// ユーティリティ
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
