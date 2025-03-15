/**
 * @file sort.js
 * @description 服务器状态卡片排序、拖拽功能和数据管理系统
 */

// 系统初始化管理器
const SystemInitializer = {
    initialized: false,

    async init() {
        // 最早期检查游客状态并禁用拖拽
        if (this.initialized) return;

        try {
            // 1. 等待页面完全加载
            await new Promise(resolve => {
                if (document.readyState === 'complete') {
                    resolve();
                } else {
                    window.addEventListener('load', resolve, { once: true });
                }
            });

            // 2. 等待 StatsController 加载
            await this.ensureControllerLoaded();

            // 3. 等待首次数据更新完成
            await this.ensureFirstDataLoad();

            // 4. 初始化各个管理器
            await Promise.all([
                TabManager.init(),
                StateManager.init(),
                DataManager.init(),
                DragManager.init()
            ]);

            this.initialized = true;
            console.log('系统初始化完成');
        } catch (error) {
            console.error('系统初始化失败:', error);
            setTimeout(() => this.init(), 5000);
        }
    },

    async ensureControllerLoaded() {
        let retries = 0;
        const maxRetries = 20;

        while (retries < maxRetries) {
            if (typeof StatsController !== 'undefined') {
                console.log('StatsController 加载完成');
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            retries++;
            console.log(`等待 StatsController 加载... (${retries}/${maxRetries})`);
        }
        throw new Error('StatsController 加载超时');
    },

    async ensureFirstDataLoad() {
        let retries = 0;
        const maxRetries = 20;

        while (retries < maxRetries) {
            // 检查是否有服务器卡片被渲染
            const cards = document.querySelectorAll('.server-card');
            if (cards.length > 0) {
                // 检查数据是否已加载
                const hasData = Array.from(cards).some(card => {
                    const cpu = card.querySelector('[id$="_CPU"]');
                    return cpu && cpu.textContent !== 'NaN';
                });

                if (hasData) {
                    console.log('数据加载完成');
                    return true;
                }
            }

            // 尝试触发数据更新
            if (typeof StatsController !== 'undefined') {
                try {
                    await StatsController.update();
                } catch (error) {
                    console.warn('数据更新失败，重试中...', error);
                }
            }

            await new Promise(resolve => setTimeout(resolve, 500));
            retries++;
            console.log(`等待数据加载... (${retries}/${maxRetries})`);
        }
        throw new Error('数据加载超时');
    }
};

// 状态管理器
const StateManager = {
    state: {
        isUpdating: false,
        lastUpdateTime: null,
        updateError: null,
        connectionStatus: 'disconnected',
        dragActive: false
    },

    observers: new Set(),

    async init() {

        this.initEventListeners();
        return true;
    },

    setState(newState) {
        Object.assign(this.state, newState);
        this.notifyObservers();
    },

    subscribe(callback) {
        this.observers.add(callback);
    },

    unsubscribe(callback) {
        this.observers.delete(callback);
    },

    notifyObservers() {
        this.observers.forEach(callback => callback(this.state));
    },

    initEventListeners() {
        window.addEventListener('statsUpdate', () => {
            this.setState({ lastUpdateTime: Date.now() });
        });
    }
};

// 数据管理器
const DataManager = {
    updateInterval: null,
    retryTimeout: null,

    async init() {
        this.startAutoUpdate();
        return true;
    },

    async updateStats() {
        if (StateManager.state.isUpdating) return;

        try {
            StateManager.setState({ isUpdating: true });

            if (typeof StatsController === 'undefined') {
                throw new Error('StatsController not found');
            }

            await StatsController.update();

            StateManager.setState({
                lastUpdateTime: Date.now(),
                updateError: null,
                connectionStatus: 'connected'
            });

        } catch (error) {
            console.error('数据更新失败:', error);
            StateManager.setState({
                updateError: error,
                connectionStatus: 'error'
            });
            this.scheduleRetry();
        } finally {
            StateManager.setState({ isUpdating: false });
        }
    },

    startAutoUpdate(interval = 2000) {
        this.stopAutoUpdate();
        this.updateInterval = setInterval(() => this.updateStats(), interval);
    },

    stopAutoUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    },

    scheduleRetry(delay = 5000) {
        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
        }
        this.retryTimeout = setTimeout(() => this.updateStats(), delay);
    }
};

// 拖拽状态管理
const DragState = {
    drag: {
        active: false,
        source: null,
        sourceGroup: null,
        target: null,
        targetGroup: null
    }
};

// Sortable.js 配置
const SortableConfig = {
    // 基础配置
    base: {
        group: 'servers',
        animation: 300,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        delay: 100,
        delayOnTouchOnly: true,

        // 拖拽样式
        ghostClass: "opacity-50",
        dragClass: "dragging",
        chosenClass: "chosen",

        // 性能优化
        forceFallback: false,
        fallbackTolerance: 3,
        fallbackOnBody: true,

        // 滚动设置
        scroll: true,
        scrollSensitivity: 30,
        scrollSpeed: 10,

        // 排序设置
        swapThreshold: 0.65,
        invertSwap: true,

        // 禁用离线和隐藏项
        filter: '.offline, .hidden',
        preventOnFilter: true
    },

    // 移动端配置
    mobile: {
        delay: 300,
        touchStartThreshold: 5,
        scrollSensitivity: 50
    }
};

// API 调用管理
const DragAPI = {
    endpoints: {
        updateGroup: (sid) => `/api/server/${sid}`,
        updateOrder: '/admin/servers/ord'
    },

    async updateServerGroup(serverId, groupId) {
        try {
            const response = await fetch(this.endpoints.updateGroup(serverId), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group_id: groupId })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            if (!result.success) {
                throw new Error(result.message || '更新分组失败');
            }

            return result;
        } catch (error) {
            console.error('更新服务器分组失败:', error);
            throw new Error(`更新分组失败: ${error.message}`);
        }
    },

    async updateServerOrder(serverIds) {
        try {
            const response = await fetch(this.endpoints.updateOrder, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    servers: serverIds,
                    group_context: true // 添加标记，表明这是分组上下文的排序
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            if (!result.status) {
                throw new Error(result.msg || '更新排序失败');
            }

            return result;
        } catch (error) {
            console.error('更新服务器排序失败:', error);
            throw new Error(`更新排序失败: ${error.message}`);
        }
    }
};

// 动画效果管理
const DragAnimations = {
    addDragFeedback(element) {
        requestAnimationFrame(() => {
            element.style.transform = 'scale(1.02)';
            element.style.boxShadow = '0 5px 15px rgba(0,0,0,0.3)';
            element.style.transition = 'transform 0.2s, box-shadow 0.2s';
        });
    },

    removeDragFeedback(element) {
        requestAnimationFrame(() => {
            element.style.transform = '';
            element.style.boxShadow = '';
        });
    },

    addDropAnimation(element, type = 'success') {
        element.style.animation = `${type} 0.5s cubic-bezier(0.4, 0, 0.2, 1)`;
        setTimeout(() => element.style.animation = '', 500);
    }
};

// 拖拽管理器
const DragManager = {
    sortableInstances: new Map(),
    initRetries: 0,
    maxRetries: 5,
    retryDelay: 1000,

    // 添加全局状态检查
    isDragEnabled() {
        // 若是游客则直接返回 false
        if (window.isGuestMode) {
            return false;
        }
        const dragSortToggle = document.getElementById('enable-drag-sort');
        return dragSortToggle && dragSortToggle.checked && !dragSortToggle.disabled;
    },

    getContainers() {
        // 这里根据你的页面结构，返回所有需要支持拖拽的 .grid 容器
        // 例如，下面这样选出所有 .group-view 里的 .grid
        return document.querySelectorAll('.group-view .grid');
    },


    init() {

        // 检查拖拽是否启用
        if (!this.isDragEnabled()) {
            console.log('拖拽功能已禁用');
            this.destroy(); // 确保清理任何可能的实例
            return;
        }

        this.createSortables(this.getContainers());
    },

    createSortables(containers) {
        // 如果拖拽被禁用，直接返回
        if (!this.isDragEnabled()) {
            return [];
        }

        containers.forEach(grid => {
            if (this.sortableInstances.has(grid)) {
                this.sortableInstances.get(grid).destroy();
                this.sortableInstances.delete(grid);
            }

            const groupId = grid.closest('.group-view')?.dataset.group;
            const isAllView = groupId === 'all';

            // 确保所有卡片的 draggable 属性正确设置
            grid.querySelectorAll('.server-card').forEach(card => {
                card.draggable = this.isDragEnabled();
                const handle = card.querySelector('.server-card-handle');
                if (handle) {
                    if (!this.isDragEnabled()) {
                        handle.classList.remove('cursor-move');
                    } else {
                        handle.classList.add('cursor-move');
                    }
                }
            });

            const sortable = new Sortable(grid, {
                ...SortableConfig.base,
                animation: 150,
                delay: 50,
                delayOnTouchOnly: true,
                disabled: !this.isDragEnabled(),

                // 根据不同视图设置不同的排序权限
                sort: isAllView, // 只在全部视图允许排序
                group: {
                    name: 'servers',
                    pull: !isAllView, // 分组视图允许拖出
                    put: !isAllView  // 分组视图允许放入
                },

                ghostClass: "sortable-ghost",
                chosenClass: "sortable-chosen",
                dragClass: "sortable-drag",

                swapThreshold: 0.65,
                invertSwap: true,
                direction: 'vertical',

                // 添加拖拽前的状态检查
                onStart: (evt) => {
                    if (!this.isDragEnabled()) {
                        evt.preventDefault();
                        return false;
                    }
                    const item = evt.item;
                    const container = evt.from;
                    const fromGroupId = container.closest('.group-view')?.dataset.group;

                    // 记录开始拖拽的位置
                    DragState.drag = {
                        ...DragState.drag,
                        startIndex: Array.from(container.children).indexOf(item),
                        sourceGroup: fromGroupId
                    };

                    // 添加视觉反馈
                    requestAnimationFrame(() => {
                        item.style.opacity = '0.95';
                        item.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                    });
                },

                onMove: (evt, originalEvent) => {
                    if (!this.isDragEnabled()) {
                        return false;
                    }
                    const { dragged, related, to, from } = evt;
                    const toGroupId = to.closest('.group-view')?.dataset.group;
                    const fromGroupId = from.closest('.group-view')?.dataset.group;

                    // 禁止在分组视图内排序
                    if (!isAllView && toGroupId === fromGroupId) {
                        return false;
                    }

                    // 禁止从其他视图拖入全部视图
                    if (toGroupId === 'all' && fromGroupId !== 'all') {
                        return false;
                    }

                    // 计算移动方向
                    const dragRect = dragged.getBoundingClientRect();
                    const relatedRect = related.getBoundingClientRect();
                    const moveUp = dragRect.top < relatedRect.top;

                    // 为其他卡片添加移动动画
                    Array.from(to.children).forEach(child => {
                        if (child === dragged) return;

                        const childRect = child.getBoundingClientRect();
                        if (moveUp && childRect.top > dragRect.top && childRect.top < relatedRect.top) {
                            child.style.transform = 'translateY(calc(100% + 1rem))';
                            child.classList.add('moving');
                        } else if (!moveUp && childRect.top < dragRect.top && childRect.top > relatedRect.top) {
                            child.style.transform = 'translateY(calc(-100% - 1rem))';
                            child.classList.add('moving');
                        } else {
                            child.style.transform = '';
                            child.classList.remove('moving');
                        }
                    });

                    return true;
                },

                onEnd: async (evt) => {
                    const { item, to, from } = evt;
                    const toGroupId = to.closest('.group-view')?.dataset.group;
                    const fromGroupId = from.closest('.group-view')?.dataset.group;

                    // 移除所有动画类
                    Array.from(to.children).forEach(child => {
                        child.style.transform = '';
                        child.style.transition = '';
                        child.classList.remove('moving');
                    });

                    // 移除拖动样式
                    item.style.opacity = '';
                    item.style.backgroundColor = '';

                    if (!evt.to) return;

                    try {
                        // 添加插入动画
                        item.classList.add('card-inserted');
                        setTimeout(() => item.classList.remove('card-inserted'), 150);

                        // 如果是全部视图的排序，或者是跨组拖拽
                        if ((toGroupId === 'all' && fromGroupId === 'all') || toGroupId !== fromGroupId) {
                            await this.updateCardPosition(item, toGroupId, to);
                        } else {
                            // 如果是组内拖拽，回滚到原始位置
                            const children = Array.from(from.children);
                            if (DragState.drag.startIndex < children.length) {
                                from.insertBefore(item, children[DragState.drag.startIndex]);
                            } else {
                                from.appendChild(item);
                            }
                        }
                    } catch (error) {
                        // 如果更新失败，回滚到原始位置
                        const children = Array.from(from.children);
                        if (DragState.drag.startIndex < children.length) {
                            from.insertBefore(item, children[DragState.drag.startIndex]);
                        } else {
                            from.appendChild(item);
                        }
                    }
                }
            });

            this.sortableInstances.set(grid, sortable);
        });
    },

    async waitForTabActivation() {
        let retries = 0;
        const maxRetries = 10;

        while (retries < maxRetries) {
            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
            retries++;
        }
        throw new Error('等待标签页激活超时');
    },

    async waitForElements() {
        let retries = 0;
        const maxRetries = 10;

        while (retries < maxRetries) {
            // 等待默认标签页激活
            const activeTab = document.querySelector('.tab-btn.active');
            if (!activeTab) {
                await new Promise(resolve => setTimeout(resolve, 100));
                retries++;
                continue;
            }

            // 获取当前激活的分组视图
            const activeGroupId = activeTab.dataset.group;
            const activeView = document.querySelector(`.group-view[data-group="${activeGroupId}"]`);
            if (!activeView) {
                await new Promise(resolve => setTimeout(resolve, 100));
                retries++;
                continue;
            }

            // 获取卡片容器
            const container = activeView.querySelector('.grid');
            const cards = container?.querySelectorAll('.server-card');

            if (container && cards.length > 0) {
                // 检查数据是否已加载
                const hasData = Array.from(cards).some(card => {
                    const cpu = card.querySelector('[id$="_CPU"]');
                    return cpu && cpu.textContent !== 'NaN';
                });

                if (hasData) {
                    return {
                        containers: [container],
                        tabButtons: document.querySelectorAll('.tab-btn[data-group]:not([data-group="all"])')
                    };
                }
            }

            await new Promise(resolve => setTimeout(resolve, 100));
            retries++;
            console.log(`等待页面元素加载... (${retries}/${maxRetries})`);
        }
        return null;
    },

    async initDragDrop(elements) {
        if (!elements) {
            throw new Error('找不到必要的页面元素');
        }

        try {
            await Promise.all([
                this.initCardContainers(elements.containers),
                this.initTabDropZones(elements.tabButtons)
            ]);
        } catch (error) {
            console.error('初始化拖拽功能失败:', error);
            throw error;
        }
    },

    initTabChangeListener() {
        document.querySelectorAll('.tab-btn').forEach(tab => {
            tab.addEventListener('click', async () => {
                // 等待视图切换动画完成
                await new Promise(resolve => setTimeout(resolve, 300));

                // 重新初始化当前视图的拖拽功能
                const groupId = tab.dataset.group;
                const view = document.querySelector(`.group-view[data-group="${groupId}"]`);
                const container = view?.querySelector('.grid');

                if (container) {
                    await this.initCardContainers([container]);
                }
            });
        });
    },

    initCardContainers(containers) {
        if (!containers || containers.length === 0) {
            throw new Error('无效的容器元素');
        }

        // 添加必要的CSS样式
        if (!document.getElementById('sortable-styles')) {
            const style = document.createElement('style');
            style.id = 'sortable-styles';
            style.textContent = `
                .sortable-ghost {
                    opacity: 0.5;
                    background: rgba(255, 255, 255, 0.05);
                    backdrop-filter: blur(4px);
                    border: 1px solid rgba(107, 114, 128, 0.5);
                    transform: scale(0.98);
                }
                
                .sortable-chosen {
                    background: rgba(255, 255, 255, 0.1);
                    transform: scale(1.02);
                    z-index: 10;
                }
                
                .sortable-drag {
                    opacity: 0.95;
                    background: rgba(255, 255, 255, 0.1);
                    backdrop-filter: blur(8px);
                    border: 1px solid rgba(107, 114, 128, 0.5);
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
                    transform: scale(1.02);
                    z-index: 100;
                }
                
                .server-card {
                    transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
                    will-change: transform, opacity, background-color;
                }
                
                .server-card.moving {
                    transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
                }
                
                .server-card.sort-disabled {
                    cursor: no-drop;
                }
                
                @keyframes cardInsert {
                    from {
                        opacity: 0;
                        transform: scale(0.8);
                    }
                    to {
                        opacity: 1;
                        transform: scale(1);
                    }
                }
                
                .card-inserted {
                    animation: cardInsert 150ms cubic-bezier(0.4, 0, 0.2, 1);
                }
            `;
            document.head.appendChild(style);
        }

        containers.forEach(grid => {
            if (this.sortableInstances.has(grid)) {
                this.sortableInstances.get(grid).destroy();
                this.sortableInstances.delete(grid);
            }

            const groupId = grid.closest('.group-view')?.dataset.group;
            const isAllView = groupId === 'all';

            const sortable = new Sortable(grid, {
                ...SortableConfig.base,
                animation: 150,
                delay: 50,
                disabled: !this.isDragEnabled(),
                delayOnTouchOnly: true,

                // 根据不同视图设置不同的排序权限
                sort: isAllView, // 只在全部视图允许排序
                group: {
                    name: 'servers',
                    pull: !isAllView, // 分组视图允许拖出
                    put: !isAllView  // 分组视图允许放入
                },

                ghostClass: "sortable-ghost",
                chosenClass: "sortable-chosen",
                dragClass: "sortable-drag",

                swapThreshold: 0.65,
                invertSwap: true,
                direction: 'vertical',

                onStart: (evt) => {
                    if (!this.isDragEnabled()) {
                        evt.preventDefault();
                        return false;
                    }
                    const item = evt.item;
                    const container = evt.from;
                    const fromGroupId = container.closest('.group-view')?.dataset.group;

                    // 记录开始拖拽的位置
                    DragState.drag = {
                        ...DragState.drag,
                        startIndex: Array.from(container.children).indexOf(item),
                        sourceGroup: fromGroupId
                    };

                    // 添加视觉反馈
                    requestAnimationFrame(() => {
                        item.style.opacity = '0.95';
                        item.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                    });
                },

                onMove: (evt, originalEvent) => {
                    if (!this.isDragEnabled()) {
                        return false;
                    }
                    const { dragged, related, to, from } = evt;
                    const toGroupId = to.closest('.group-view')?.dataset.group;
                    const fromGroupId = from.closest('.group-view')?.dataset.group;

                    // 禁止在分组视图内排序
                    if (!isAllView && toGroupId === fromGroupId) {
                        return false;
                    }

                    // 禁止从其他视图拖入全部视图
                    if (toGroupId === 'all' && fromGroupId !== 'all') {
                        return false;
                    }

                    // 计算移动方向
                    const dragRect = dragged.getBoundingClientRect();
                    const relatedRect = related.getBoundingClientRect();
                    const moveUp = dragRect.top < relatedRect.top;

                    // 为其他卡片添加移动动画
                    Array.from(to.children).forEach(child => {
                        if (child === dragged) return;

                        const childRect = child.getBoundingClientRect();
                        if (moveUp && childRect.top > dragRect.top && childRect.top < relatedRect.top) {
                            child.style.transform = 'translateY(calc(100% + 1rem))';
                            child.classList.add('moving');
                        } else if (!moveUp && childRect.top < dragRect.top && childRect.top > relatedRect.top) {
                            child.style.transform = 'translateY(calc(-100% - 1rem))';
                            child.classList.add('moving');
                        } else {
                            child.style.transform = '';
                            child.classList.remove('moving');
                        }
                    });

                    return true;
                },

                onEnd: async (evt) => {
                    const { item, to, from } = evt;
                    const toGroupId = to.closest('.group-view')?.dataset.group;
                    const fromGroupId = from.closest('.group-view')?.dataset.group;

                    // 移除所有动画类
                    Array.from(to.children).forEach(child => {
                        child.style.transform = '';
                        child.style.transition = '';
                        child.classList.remove('moving');
                    });

                    // 移除拖动样式
                    item.style.opacity = '';
                    item.style.backgroundColor = '';

                    if (!evt.to) return;

                    try {
                        // 添加插入动画
                        item.classList.add('card-inserted');
                        setTimeout(() => item.classList.remove('card-inserted'), 150);

                        // 如果是全部视图的排序，或者是跨组拖拽
                        if ((toGroupId === 'all' && fromGroupId === 'all') || toGroupId !== fromGroupId) {
                            await this.updateCardPosition(item, toGroupId, to);
                        } else {
                            // 如果是组内拖拽，回滚到原始位置
                            const children = Array.from(from.children);
                            if (DragState.drag.startIndex < children.length) {
                                from.insertBefore(item, children[DragState.drag.startIndex]);
                            } else {
                                from.appendChild(item);
                            }
                        }
                    } catch (error) {
                        // 如果更新失败，回滚到原始位置
                        const children = Array.from(from.children);
                        if (DragState.drag.startIndex < children.length) {
                            from.insertBefore(item, children[DragState.drag.startIndex]);
                        } else {
                            from.appendChild(item);
                        }
                    }
                }
            });

            this.sortableInstances.set(grid, sortable);
        });
    },

    async initTabDropZones(tabButtons) {
        console.log('标签页拖拽功能由 TabManager 处理');
    },

    handleChoose(evt) {
        const item = evt.item;
        if (!this.canDrag(item)) {
            evt.preventDefault();
            return;
        }
        DragState.drag.source = item;
        DragState.drag.sourceGroup = item.closest('.group-view')?.dataset.group;
        StateManager.setState({ dragActive: true });
    },

    handleStart(evt) {
        DragState.drag.active = true;
        DragAnimations.addDragFeedback(evt.item);
        document.body.classList.add('dragging-active');
    },

    handleMove(evt, originalEvent) {
        if (!this.canDrop(evt.to, evt.dragged)) {
            return false;
        }
        return true;
    },

    handleClone(evt) {
        const clone = evt.clone;
        clone.style.pointerEvents = 'none';
        clone.style.transform = 'translate3d(0, 0, 0)';
        clone.style.willChange = 'transform';
    },

    async handleEnd(evt) {
        const item = evt.item;
        DragState.drag.active = false;
        DragAnimations.removeDragFeedback(item);
        document.body.classList.remove('dragging-active');
        StateManager.setState({ dragActive: false });

        if (!evt.to) return;

        const targetGroup = evt.to.closest('.group-view')?.dataset.group;
        if (targetGroup === 'all') {
            evt.from.appendChild(item);
            return;
        }

        try {
            await this.updateCardPosition(item, targetGroup, evt.to);
            DragAnimations.addDropAnimation(item, 'success');
        } catch (error) {
            console.error('拖拽更新失败:', error);
            evt.from.appendChild(item);
            DragAnimations.addDropAnimation(item, 'error');
            Utils.showToast('更新失败', 'error');
        }
    },

    async updateCardPosition(card, groupId, container) {
        if (window.isGuestMode) {
            return;
        }
        if (StateManager.state.isUpdating) {
            console.warn('状态更新中，请稍后再试');
            return;
        }

        try {
            StateManager.setState({ isUpdating: true });

            // 1. 如果是跨组拖拽
            const currentGroup = card.closest('.group-view')?.dataset.group;
            if (currentGroup !== groupId) {
                const targetContainer = document.querySelector(`.group-view[data-group="${groupId}"] .grid`);
                if (targetContainer) {
                    // 在新组中插入卡片
                    const cards = Array.from(targetContainer.querySelectorAll('.server-card'));
                    const insertIndex = this.findInsertIndex(cards, card);
                    if (insertIndex === cards.length) {
                        targetContainer.appendChild(card);
                    } else {
                        targetContainer.insertBefore(card, cards[insertIndex]);
                    }
                }
                await DragAPI.updateServerGroup(card.dataset.sid, groupId);
            }

            // 2. 更新排序
            if (container) {
                const cards = Array.from(container.querySelectorAll('.server-card'));
                const baseOrder = Date.now();

                // 生成排序数据
                const updates = cards.map((card, index) => ({
                    sid: card.dataset.sid,
                    top: baseOrder - (index * 1000), // 使用更大的间隔，便于后续插入
                    group: card.closest('.group-view')?.dataset.group
                }));

                // 只更新当前分组内的排序
                const groupUpdates = updates.filter(update => update.group === groupId);
                if (groupUpdates.length > 0) {
                    await DragAPI.updateServerOrder(groupUpdates.map(u => u.sid));
                }
            }

            Utils.showToast('更新成功', 'success');
        } catch (error) {
            console.error('更新失败:', error);
            Utils.showToast(error.message || '更新失败', 'error');
            throw error;
        } finally {
            StateManager.setState({ isUpdating: false });
        }
    },

    findInsertIndex(cards, draggedCard) {
        // 如果没有其他卡片，插入到末尾
        if (cards.length === 0) return 0;

        // 获取拖拽卡片的位置
        const dragRect = draggedCard.getBoundingClientRect();

        // 找到第一个中心点在拖拽卡片下方的卡片
        for (let i = 0; i < cards.length; i++) {
            const cardRect = cards[i].getBoundingClientRect();
            const cardCenter = cardRect.top + cardRect.height / 2;

            if (dragRect.top < cardCenter) {
                return i;
            }
        }

        // 如果都在上方，插入到末尾
        return cards.length;
    },

    canDrag(element) {
        // 统一使用数据属性判断（修改判断逻辑）
        return element.dataset.status === 'online' &&
            !StateManager.state.isUpdating;
    },

    canDrop(to, element) {
        if (!to || !element) return false;

        // 获取目标分组
        const targetGroup = to.closest('.group-view')?.dataset.group;
        if (!targetGroup || targetGroup === 'all') return false;

        // 检查源和目标是否相同
        const sourceGroup = element.closest('.group-view')?.dataset.group;
        if (targetGroup === sourceGroup) return false;

        // 检查全局状态
        return !StateManager.state.isUpdating;
    },

    clearTabEffects() {
        document.querySelectorAll('.tab-btn').forEach(tab => {
            tab.classList.remove('drag-over', 'drag-target', 'drop-target');
            tab.style.animation = '';
        });
    },

    isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    },

    // 清理资源
    destroy() {
        try {
            // 清理排序实例
            this.sortableInstances.forEach(instance => {
                try {
                    instance.destroy();
                } catch (error) {
                    console.warn('清理排序实例失败:', error);
                }
            });
            this.sortableInstances.clear();

            // 移除所有卡片的 draggable 属性
            document.querySelectorAll('.server-card').forEach(card => {
                card.draggable = false;
            });

            // 清理事件监听器
            document.querySelectorAll('.tab-btn').forEach(tab => {
                const newTab = tab.cloneNode(true);
                tab.parentNode.replaceChild(newTab, tab);
            });

            // 清理状态
            DragState.drag = {
                active: false,
                source: null,
                sourceGroup: null,
                target: null,
                targetGroup: null
            };

            // 清理样式
            document.body.classList.remove('dragging-active');
            this.clearTabEffects();

            // 停止自动更新
            DataManager.stopAutoUpdate();

            console.log('拖拽功能已清理');
        } catch (error) {
            console.error('清理资源失败:', error);
        }
    },

    // 重置状态
    reset() {
        this.destroy();
        this.initRetries = 0;
        return this.init();
    }
};

// 工具函数
const Utils = {
    showToast(message, type = 'info') {
        if (typeof notice === 'function') {
            notice(message);
        } else {
            const toast = document.createElement('div');
            toast.className = `fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 ${type === 'error' ? 'bg-red-500' :
                type === 'success' ? 'bg-green-500' :
                    'bg-blue-500'
                } text-white transition-opacity duration-300`;
            toast.textContent = message;

            document.body.appendChild(toast);
            setTimeout(() => {
                toast.classList.add('opacity-0');
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }
    }
};

// 性能监控器
const PerformanceMonitor = {
    metrics: {
        updateTimes: [],
        errors: [],
        lastResponseTime: null
    },

    startMonitoring() {
        StateManager.subscribe(this.handleStateChange.bind(this));
    },

    handleStateChange(state) {
        if (!state.isUpdating && state.lastUpdateTime) {
            this.recordUpdate(Date.now() - state.lastUpdateTime);
        }

        if (state.updateError) {
            this.recordError(state.updateError);
        }
    },

    recordUpdate(duration) {
        this.metrics.updateTimes.push({
            time: Date.now(),
            duration
        });

        if (this.metrics.updateTimes.length > 100) {
            this.metrics.updateTimes.shift();
        }

        this.analyzePerformance();
    },

    recordError(error) {
        this.metrics.errors.push({
            time: Date.now(),
            error: error.message
        });

        if (this.metrics.errors.length > 50) {
            this.metrics.errors.shift();
        }
    },

    analyzePerformance() {
        const recentUpdates = this.metrics.updateTimes.slice(-10);
        if (recentUpdates.length === 0) return;

        const avgDuration = recentUpdates.reduce((sum, record) => sum + record.duration, 0) / recentUpdates.length;

        if (avgDuration > 1000) {
            console.warn('性能警告: 数据更新平均耗时超过1秒');
            // 可以在这里添加性能优化策略
        }
    },

    getMetrics() {
        return {
            averageUpdateTime: this.calculateAverageUpdateTime(),
            errorRate: this.calculateErrorRate(),
            totalUpdates: this.metrics.updateTimes.length,
            totalErrors: this.metrics.errors.length
        };
    },

    calculateAverageUpdateTime() {
        if (this.metrics.updateTimes.length === 0) return 0;
        const sum = this.metrics.updateTimes.reduce((acc, record) => acc + record.duration, 0);
        return sum / this.metrics.updateTimes.length;
    },

    calculateErrorRate() {
        if (this.metrics.updateTimes.length === 0) return 0;
        return this.metrics.errors.length / this.metrics.updateTimes.length;
    }
};

// 标签页管理器
const TabManager = {
    // 存储所有标签页的引用
    tabs: new Map(),

    async init() {
        try {
            // 1. 初始化所有标签页
            const tabs = document.querySelectorAll('.tab-btn');

            for (const tab of tabs) {
                await this.initTab(tab);
            }

            // 2. 激活默认标签页
            const defaultTab = document.querySelector('.tab-btn[data-group="all"]');
            if (defaultTab) {
                await this.activateTab(defaultTab);
            }

            console.log('标签页管理器初始化完成');
            return true;
        } catch (error) {
            console.error('标签页管理器初始化失败:', error);
            throw error;
        }
    },

    async initTab(tab) {
        try {
            // 1. 基础事件处理
            const handlers = {
                click: async (e) => {
                    e.preventDefault();
                    if (StateManager.state.isUpdating || StateManager.state.dragActive) {
                        console.warn('系统正忙，请稍后再试');
                        return;
                    }
                    await this.activateTab(tab);
                }
            };

            // 2. 如果是分组标签，添加拖拽处理
            if (tab.dataset.group && tab.dataset.group !== 'all') {
                Object.assign(handlers, this.getDragHandlers(tab));
            }

            // 3. 绑定所有事件处理器
            Object.entries(handlers).forEach(([event, handler]) => {
                tab.addEventListener(event, handler.bind(this));
            });

            // 4. 存储标签页引用
            this.tabs.set(tab.dataset.group, tab);

            console.log('标签页初始化完成:', tab.dataset.group);
        } catch (error) {
            console.error('标签页初始化失败:', error);
            throw error;
        }
    },

    async activateTab(tab) {
        try {
            // 1. 移除其他标签页的激活状态
            this.tabs.forEach(t => {
                t.classList.remove('active', 'text-white', 'bg-slate-700/60', 'border-primary-500');
            });

            // 2. 激活当前标签页
            tab.classList.add('active', 'text-white', 'bg-slate-700/60', 'border-primary-500');

            // 3. 切换视图
            const groupId = tab.dataset.group;
            const views = document.querySelectorAll('.group-view');

            views.forEach(view => {
                if (view.dataset.group === groupId) {
                    view.classList.remove('hidden');
                    // 使用 requestAnimationFrame 确保过渡动画顺滑
                    requestAnimationFrame(() => {
                        view.classList.remove('opacity-0');
                        view.classList.add('opacity-100');
                    });
                } else {
                    view.classList.add('opacity-0');
                    view.classList.remove('opacity-100');
                    // 等待过渡动画完成后隐藏
                    setTimeout(() => {
                        if (!view.classList.contains('opacity-100')) {
                            view.classList.add('hidden');
                        }
                    }, 300);
                }
            });

            // 4. 重新初始化当前视图的拖拽功能
            const container = document.querySelector(`.group-view[data-group="${groupId}"] .grid`);
            if (container) {
                await DragManager.initCardContainers([container]);
            }

            console.log('视图切换完成:', groupId);
        } catch (error) {
            console.error('视图切换失败:', error);
            Utils.showToast('视图切换失败，请刷新页面重试', 'error');
        }
    },

    getDragHandlers(tab) {
        return {
            dragenter: (e) => {
                e.preventDefault();
                if (tab.dataset.group !== 'all') {
                    tab.classList.add('drag-target');
                    tab.style.animation = 'pulse 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
                }
            },
            dragover: (e) => {
                e.preventDefault();
                if (tab.dataset.group !== 'all') {
                    DragManager.clearTabEffects();
                    tab.classList.add('drag-over');
                }
            },
            dragleave: (e) => {
                e.preventDefault();
                tab.classList.remove('drag-over', 'drag-target');
                tab.style.animation = '';
            },
            drop: async (e) => {
                e.preventDefault();
                e.stopPropagation();
                DragManager.clearTabEffects();

                if (!DragState.drag.source || tab.dataset.group === 'all') return;

                try {
                    tab.classList.add('drop-target');
                    setTimeout(() => tab.classList.remove('drop-target'), 300);

                    await DragManager.updateCardPosition(DragState.drag.source, tab.dataset.group);

                    tab.style.animation = 'success 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
                    setTimeout(() => {
                        tab.style.animation = '';
                        tab.click();
                    }, 500);
                } catch (error) {
                    console.error('更新失败:', error);
                    tab.style.animation = 'error 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
                    setTimeout(() => tab.style.animation = '', 500);
                }
            }
        };
    },

    // 清理资源
    destroy() {
        try {
            this.tabs.forEach(tab => {
                const newTab = tab.cloneNode(true);
                tab.parentNode.replaceChild(newTab, tab);
            });
            this.tabs.clear();
            console.log('标签页管理器已清理');
        } catch (error) {
            console.error('标签页管理器清理失败:', error);
        }
    }
};

// 获取排序值的辅助函数
function getSortValue(card, type) {
    let value = 0;

    // 优先使用data属性中的值
    switch (type) {
        case 'default':
            return Number(card.dataset.top || 0);
        case 'cpu':
            return Number(card.dataset.cpu || 0);
        case 'memory':
            return Number(card.dataset.memory || 0);
        case 'download':
            return Number(card.dataset.download || 0);
        case 'upload':
            return Number(card.dataset.upload || 0);
        case 'expiration':
            return Number(card.dataset.expiration || 0);
        default:
            return 0;
    }
}

// 执行排序
function applySort(type, direction = 'desc') {
    const activeGroupId = document.querySelector('.group-view:not(.hidden)')?.dataset.group;
    if (!activeGroupId) return;

    const container = activeGroupId === 'all' ?
        document.querySelector('.group-view[data-group="all"] .grid') :
        document.getElementById(`card-grid-${activeGroupId}`);

    if (!container) return;

    // 保存拖拽状态
    const cards = Array.from(container.querySelectorAll('.server-card'));
    const dragStates = cards.map(card => ({
        element: card,
        state: {
            dragData: card.getAttribute('draggable'),
            dragEvents: card.getAttribute('data-has-drag-events')
        }
    }));

    // 临时禁用拖拽
    cards.forEach(card => {
        card.removeAttribute('draggable');
        card.removeAttribute('data-has-drag-events');
    });

    // 执行排序
    cards.sort((a, b) => {
        // 获取在线状态
        const isOnlineA = a.querySelector('[id$="_status_indicator"]')?.classList.contains('bg-green-500') || false;
        const isOnlineB = b.querySelector('[id$="_status_indicator"]')?.classList.contains('bg-green-500') || false;

        // 如果在线状态不同，在线的排在前面
        if (isOnlineA !== isOnlineB) {
            return isOnlineA ? -1 : 1;
        }

        // 获取排序值
        const valueA = getSortValue(a, type);
        const valueB = getSortValue(b, type);

        // 如果值相同，按top值排序
        if (valueA === valueB) {
            const topA = Number(a.dataset.top || 0);
            const topB = Number(b.dataset.top || 0);
            return topB - topA;
        }

        // 根据排序方向返回比较结果
        return direction === 'asc' ? valueA - valueB : valueB - valueA;
    });

    // 更新DOM
    cards.forEach(card => container.appendChild(card));

    // 恢复拖拽状态
    dragStates.forEach(({ element, state }) => {
        if (state.dragData) {
            element.setAttribute('draggable', state.dragData);
        }
        if (state.dragEvents) {
            element.setAttribute('data-has-drag-events', 'true');
        }
    });

    // 更新排序按钮状态
    updateSortButtonStates(type, direction);
}

// 系统主初始化入口
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 1. 等待页面完全加载
        await new Promise(resolve => {
            if (document.readyState === 'complete') {
                resolve();
            } else {
                window.addEventListener('load', resolve, { once: true });
            }
        });

        // 2. 启动性能监控
        PerformanceMonitor.startMonitoring();

        // 3. 初始化系统
        await SystemInitializer.init();
    } catch (error) {
        console.error('系统启动失败:', error);
        Utils.showToast('系统启动失败，请刷新页面重试', 'error');
    }
});

// 拖拽排序开关控制
document.addEventListener('DOMContentLoaded', () => {
    const dragSortToggle = document.getElementById('enable-drag-sort');
    // 检查是否为游客
    const isGuest = document.body.classList.contains('guest-user');
    if (dragSortToggle === null) {
        // 确保初始状态下禁用拖拽
        document.querySelectorAll('.server-card').forEach(card => {
            card.draggable = false;
        });
        localStorage.setItem('dragSortEnabled', 'false');
        DragManager.destroy();
        return;
    }

    // if (dragSortToggle) {





    if (isGuest) {
        // 游客禁用拖拽功能
        dragSortToggle.checked = false;
        dragSortToggle.disabled = true;
        dragSortToggle.title = '游客不能使用拖拽排序功能';
        localStorage.setItem('dragSortEnabled', 'false');
        DragManager.destroy();
    } else {
        // 从localStorage读取之前的状态，默认为false
        const isDragEnabled = localStorage.getItem('dragSortEnabled') === 'true';
        dragSortToggle.checked = isDragEnabled;

        // 根据开关状态初始化或禁用拖拽功能
        if (isDragEnabled) {
            DragManager.init();
        } else {
            DragManager.destroy();
        }

        // 监听开关变化
        dragSortToggle.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            localStorage.setItem('dragSortEnabled', enabled);

            if (enabled) {
                DragManager.init();
                notice('已启用拖拽排序功能');
            } else {
                DragManager.destroy();
                notice('已禁用拖拽排序功能');
            }
        });
    }
    // }
});

// 导出接口
window.DragManager = DragManager;
window.StateManager = StateManager;
window.DataManager = DataManager;
window.TabManager = TabManager;