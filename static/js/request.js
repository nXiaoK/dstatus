let lastChartUpdate = 0;
document.addEventListener('DOMContentLoaded', () => {
    let timer = setInterval(async () => {
        try {
            const response = await fetch('/stats/data');
            if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
            const data = await response.json();

            // 1) 更新 stat.js
            // nodeId 自行获取 or parse
            const nodeId = getNodeIdFromUrl();
            if (nodeId && data[nodeId]) {
                const validData = validateSystemData(data, nodeId);
                if (validData) {
                    updateSystemComponents(validData); // from stat.js
                } else {
                    handleError('Invalid system data');
                }
            }

            // 只有距离上次图表更新 >= 2 秒才更新图表
            const now = Date.now();
            if (now - lastChartUpdate >= 2000) {
                updateCharts(data);
                lastChartUpdate = now;
            }

        } catch (err) {
            console.error('Global fetch error:', err);
            clearAllData(); // from stat.js (optional)
        }
    }, 500);

    // If you want to handle visibilitychange:
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearInterval(timer);
            timer = null;
        } else {
            if (!timer) {
                timer = setInterval(async () => {
                    try {
                        const response = await fetch('/stats/data');
                        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
                        const data = await response.json();

                        // 1) 更新 stat.js
                        const nodeId = getNodeIdFromUrl();
                        if (nodeId && data[nodeId]) {
                            const validData = validateSystemData(data, nodeId);
                            if (validData) {
                                updateSystemComponents(validData);
                            } else {
                                handleError('Invalid system data');
                            }
                        }

                        // 只有距离上次图表更新 >= 2 秒才更新图表
                        const now = Date.now();
                        if (now - lastChartUpdate >= 2000) {
                            updateCharts(data);
                            lastChartUpdate = now;
                        }
                    } catch (err) {
                        console.error('Global fetch error:', err);
                        clearAllData();
                    }
                }, 500); // 与初始设置的间隔相同 (2秒)
            }
        }
    });

    // Cleanup on unload
    window.addEventListener('beforeunload', () => {
        if (timer) clearInterval(timer);
    });
});