document.addEventListener('DOMContentLoaded', () => {
    let skipUpdate = false;
    // 假设每2秒请求一次
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

            // 2) 每次只在 skipUpdate==false 时更新 load.js
            if (!skipUpdate) {
                updateCharts(data); // from load.js
            }

            skipUpdate = !skipUpdate; // 下次反转
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

                        // 2) 更新 load.js
                        updateCharts(data);
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