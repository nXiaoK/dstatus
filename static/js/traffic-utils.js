/**
 * 流量数据处理工具函数
 */

// 流量数据管理器
const TrafficManager = {
    state: {
        used: 0,
        limit: 0,
        ratio: 0,
        isUnlimited: false,
        lastUpdate: 0
    },
    
    // 注册更新回调
    callbacks: new Set(),
    
    // 注册UI更新回调
    onUpdate(callback) {
        this.callbacks.add(callback);
        // 如果已有数据，立即触发回调
        if (this.state.lastUpdate > 0) {
            try {
                callback(this.state);
            } catch (error) {
                console.error('[Traffic Manager] 回调执行错误:', error);
            }
        }
    },
    
    // 深度比较状态
    _isStateEqual(state1, state2) {
        return state1.used === state2.used &&
               state1.limit === state2.limit &&
               state1.ratio === state2.ratio &&
               state1.isUnlimited === state2.isUnlimited;
    },
    
    // 更新状态
    updateState(data) {
        if (!data) return;
        
        // 构建新状态
        const newState = {
            used: data.traffic_used || 0,
            limit: data.traffic_limit || 0,
            ratio: data.traffic_limit ? Math.min(1, (data.traffic_used || 0) / data.traffic_limit) : 0,
            isUnlimited: !data.traffic_limit,
            lastUpdate: Date.now()
        };
        
        // 深度比较状态，避免不必要的更新
        if (this._isStateEqual(this.state, newState)) {
            console.log('[Traffic Manager] 状态未变化，跳过更新');
            return;
        }
        
        console.log('[Traffic Manager] 更新状态:', {
            oldState: this.state,
            newState: newState
        });
        
        this.state = newState;
        
        // 通知所有监听器
        this.notifyListeners();
    },
    
    // 通知更新
    notifyListeners() {
        this.callbacks.forEach(callback => {
            try {
                callback(this.state);
            } catch (error) {
                console.error('[Traffic Manager] 更新回调执行错误:', error);
            }
        });
    },
    
    // 移除回调
    removeCallback(callback) {
        this.callbacks.delete(callback);
    }
};

// 基础工具函数
function validateTrafficValue(value) {
    const numValue = Number(value) || 0;
    return Math.max(0, numValue);
}

// 从URL获取服务器ID
function getNodeIdFromUrl() {
    const path = window.location.pathname;
    const matches = path.match(/\/stats\/([^\/]+)/);
    return matches ? matches[1] : null;
}

// 防止重复调用的标志
let isUpdating = false;

// 更新流量显示
async function updateTrafficDisplay() {
    if (isUpdating) return;
    isUpdating = true;
    
    try {
        const nodeId = getNodeIdFromUrl();
        console.log('[Traffic Utils] 当前节点ID:', nodeId);
        if (!nodeId) return;

        // 1. 获取初始数据
        const trafficData = document.getElementById('traffic_data');
        const preprocessedData = document.getElementById('preprocessed-data');
        let initialData = null;
        let lastValidData = null;  // 保存最后一次有效的数据

        if (trafficData && preprocessedData) {
            try {
                const trafficStats = JSON.parse(trafficData.value);
                const nodeData = JSON.parse(preprocessedData.value);
                
                if (nodeData && trafficStats && Array.isArray(trafficStats.ds)) {
                    initialData = {
                        ds: trafficStats.ds,
                        hs: trafficStats.hs || new Array(24).fill([0,0]),
                        ms: trafficStats.ms || new Array(12).fill([0,0]),
                        traffic_calibration_date: nodeData.traffic_calibration_date || 0,
                        traffic_calibration_value: nodeData.traffic_calibration_value || 0,
                        traffic_reset_day: nodeData.traffic_reset_day || 1,
                        traffic_limit: nodeData.traffic_limit || 0,
                        traffic_used: nodeData.traffic_used || 0
                    };
                    
                    // 保存有效的初始数据
                    lastValidData = {...initialData};
                    
                    // 立即使用初始数据更新UI
                    await processAndUpdateTraffic(initialData);
                }
            } catch (e) {
                console.error('[Traffic Utils] 解析初始数据失败:', e);
            }
        }

        // 2. 获取实时数据
        console.log('[Traffic Utils] 开始请求实时流量数据...');
        try {
            const response = await fetch(`/stats/${nodeId}/traffic`);
            
            const { data, error } = await response.json();
            // console.log('data----->',data)
            // 验证实时数据的有效性
            if (!error && data && Array.isArray(data.ds) && data.ds.length > 0) {
                const realTimeData = {
                    ds: data.ds,
                    hs: data.hs || lastValidData?.hs || new Array(24).fill([0,0]),
                    ms: data.ms || lastValidData?.ms || new Array(12).fill([0,0]),
                    traffic_calibration_date: data.calibration_date || lastValidData?.traffic_calibration_date || 0,
                    traffic_calibration_value: data.calibration_value || lastValidData?.traffic_calibration_value || 0,
                    traffic_reset_day: data.traffic_reset_day || lastValidData?.traffic_reset_day || 1,
                    traffic_limit: data.traffic_limit || lastValidData?.traffic_limit || 0,
                    traffic_used: data.traffic_used || lastValidData?.traffic_used || 0
                };

                // 验证数据合理性
                const usedTraffic = calculateUsedTraffic({
                    trafficData: realTimeData.ds,
                    resetDay: realTimeData.traffic_reset_day,
                    calibrationDate: realTimeData.traffic_calibration_date,
                    calibrationValue: realTimeData.traffic_calibration_value
                });
                console.log('usedTraffic----->',usedTraffic)

                // 只有当计算出的流量大于0时才更新
                if (usedTraffic > 0) {
                    lastValidData = {...realTimeData};
                    await processAndUpdateTraffic(realTimeData);
                } else if (lastValidData) {
                    // 如果新数据无效但有上次的有效数据，使用上次的数据
                    console.log('[Traffic Utils] 使用上次的有效数据更新');
                    await processAndUpdateTraffic(lastValidData);
                }
            } else if (lastValidData) {
                // 如果实时数据无效但有上次的有效数据，使用上次的数据
                console.log('[Traffic Utils] 实时数据无效，使用上次的有效数据');
                await processAndUpdateTraffic(lastValidData);
            }
        } catch (e) {
            console.error('[Traffic Utils] 获取实时数据失败:', e);
            // 发生错误时，如果有上次的有效数据，使用它
            if (lastValidData) {
                console.log('[Traffic Utils] 使用上次的有效数据更新');
                await processAndUpdateTraffic(lastValidData);
            }
        }
        
    } catch (error) {
        console.error('[Traffic Utils] 更新流量显示失败:', error);
    } finally {
        isUpdating = false;
    }
}

// 新增处理和更新流量数据的函数
async function processAndUpdateTraffic(data) {
    if (!data) return;
    
    try {
        // 1. 数据规范化
        const normalizedData = {
            ds: Array.isArray(data.ds) ? data.ds : [],
            traffic_reset_day: parseInt(data.traffic_reset_day) || 1,
            traffic_calibration_date: parseInt(data.traffic_calibration_date) || 0,
            traffic_calibration_value: parseFloat(data.traffic_calibration_value) || 0,
            traffic_limit: parseFloat(data.traffic_limit) || 0
        };

        // 2. 计算流量
        const usedTraffic = calculateUsedTraffic({
            trafficData: normalizedData.ds,
            resetDay: normalizedData.traffic_reset_day,
            calibrationDate: normalizedData.traffic_calibration_date,
            calibrationValue: normalizedData.traffic_calibration_value
        });

        // 3. 计算剩余流量
        const remaining = calculateRemainingTraffic({
            used: usedTraffic,
            limit: normalizedData.traffic_limit
        });

        // 4. 准备更新数据
        const processedData = {
            ...data,
            traffic_used: usedTraffic,
            traffic_limit: normalizedData.traffic_limit,
            traffic_remaining: remaining
        };

        // 5. 统一的更新流程
        await new Promise(resolve => {
            requestAnimationFrame(() => {
                // 更新状态管理器
                TrafficManager.updateState(processedData);
                
                // UI 更新完全依赖于 TrafficManager 的状态
                updateTrafficElements(processedData);
                
                resolve();
            });
        });

    } catch (error) {
        console.error('[Traffic Utils] 处理流量数据失败:', error);
    }
}

// 格式化流量数值
function formatTraffic(bytes) {
    if (bytes === null || bytes === undefined || isNaN(bytes)) {
        return '0 B';
    }

    let value = Number(bytes);
    if (!isFinite(value)) {
        return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    value = Math.abs(value);

    if (value === 0) return '0 B';

    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }

    let decimals = 2;
    if (value >= 100) decimals = 1;
    else if (value >= 10) decimals = 2;

    return value.toFixed(decimals) + ' ' + units[unitIndex];
}

// 更新进度条样式
function updateProgressBarStyle(progressBar, ratio, isUnlimited) {
    if (!progressBar) {
        console.error('[Traffic Utils] 进度条元素不存在');
        return;
    }

    // 使用 data 属性存储当前状态
    const currentRatio = parseFloat(progressBar.dataset.ratio) || 0;
    const currentUnlimited = progressBar.dataset.unlimited === 'true';
    
    // 计算新状态
    const newTransform = isUnlimited ? 'scaleX(0.25)' : `scaleX(${Math.max(0, Math.min(1, ratio))})`;
    
    // 如果状态没有变化，跳过更新
    if (currentRatio === ratio && currentUnlimited === isUnlimited) {
        console.log('[Traffic Utils] 进度条状态未改变，跳过更新');
        return;
    }
    
    // 更新状态
    progressBar.dataset.ratio = ratio;
    progressBar.dataset.unlimited = isUnlimited;
    
    console.log('[Traffic Utils] 更新进度条样式:', {
        ratio,
        isUnlimited,
        currentRatio,
        currentUnlimited,
        newTransform
    });

    // 更新进度条颜色和样式
    if (isUnlimited) {
        progressBar.classList.add('bg-green-500/50');
        progressBar.classList.remove('bg-blue-500/50', 'bg-yellow-500/50', 'bg-red-500/50');
    } else {
        progressBar.classList.remove('bg-green-500/50');
        if (ratio >= 0.9) {
            progressBar.classList.add('bg-red-500/50');
            progressBar.classList.remove('bg-blue-500/50', 'bg-yellow-500/50');
        } else if (ratio >= 0.7) {
            progressBar.classList.add('bg-yellow-500/50');
            progressBar.classList.remove('bg-blue-500/50', 'bg-red-500/50');
        } else {
            progressBar.classList.add('bg-blue-500/50');
            progressBar.classList.remove('bg-yellow-500/50', 'bg-red-500/50');
        }
    }
    
    // 使用 requestAnimationFrame 更新变换
    requestAnimationFrame(() => {
        progressBar.style.transform = newTransform;
        console.log('[Traffic Utils] 进度条样式已更新:', newTransform);
    });
}

/**
 * 更新显示元素
 * @param {Object} data - 流量数据对象
 */
function updateTrafficElements(data) {
    if (!data) {
        console.error('[Traffic Utils] 没有收到流量数据');
        return;
    }
    
    try {
        // 1. 获取UI元素
        const elements = {
            used: document.getElementById('traffic-used'),
            remaining: document.getElementById('traffic-remaining'),
            limit: document.getElementById('traffic-limit'),
            progressBar: document.getElementById('traffic-progress-bar')
        };

        // 2. 更新显示
        if (elements.used) {
            // traffic_used 已经是GB单位，转换为字节用于显示
            const usedBytes = Math.floor(data.traffic_used * 1024 * 1024 * 1024);
            console.log('[Traffic Utils] 流量转换:', {
                originalGB: data.traffic_used,
                convertedBytes: usedBytes,
                formatted: formatTraffic(usedBytes)
            });
            elements.used.textContent = formatTraffic(usedBytes);
        }

        if (elements.remaining) {
            if (data.traffic_remaining === -1) {
                elements.remaining.textContent = '∞';
            } else {
                elements.remaining.textContent = formatTraffic(data.traffic_remaining);
            }
        }

        if (elements.limit) {
            if (!data.traffic_limit) {
                elements.limit.textContent = '∞';
            } else {
                elements.limit.textContent = formatTraffic(data.traffic_limit);
            }
        }

        // 3. 更新进度条 - 使用 TrafficManager 的状态
        if (elements.progressBar) {
            const state = TrafficManager.state;
            updateProgressBarStyle(elements.progressBar, state.ratio, state.isUnlimited);
        }
        
    } catch (error) {
        console.error('[Traffic Utils] 更新流量显示元素失败:', error, error.stack);
    }
}

// 设置定时更新
function setupTrafficUpdates() {
    // 设置每分钟更新一次
    setInterval(updateTrafficDisplay, 60 * 1000);
}

// 页面加载时初始化
let initialized = false;
document.addEventListener('DOMContentLoaded', () => {
    if (!initialized) {
        console.log('[Traffic Utils] 开始初始化流量数据模块...');
        
        // 检查初始数据
        const trafficData = document.getElementById('traffic_data');
        const preprocessedData = document.getElementById('preprocessed-data');
        console.log('[Traffic Utils] 初始数据状态:', {
            trafficDataExists: !!trafficData,
            trafficDataValue: trafficData?.value,
            preprocessedDataExists: !!preprocessedData,
            preprocessedDataValue: preprocessedData?.value
        });

        initialized = true;
        
        // 注册进度条更新回调
        TrafficManager.onUpdate((state) => {
            console.log('[Traffic Utils] TrafficManager状态更新:', state);
            const progressBar = document.getElementById('traffic-progress-bar');
            if (progressBar) {
                requestAnimationFrame(() => {
                    updateProgressBarStyle(progressBar, state.ratio, state.isUnlimited);
                });
            }
        });
        
        // 立即执行一次更新
        console.log('[Traffic Utils] 开始执行初始更新...');
        updateTrafficDisplay().then(() => {
            console.log('[Traffic Utils] 初始流量数据更新完成');
        }).catch(error => {
            console.error('[Traffic Utils] 初始流量数据更新失败:', error);
        });
        
        // 设置定时更新
        setupTrafficUpdates();
        console.log('[Traffic Utils] 流量数据定时更新已设置');
    }
});

/**
 * 计算指定日期范围内的流量总和
 * @param {Array} trafficData ds数据数组
 * @param {number} startTime 开始时间戳
 * @param {number} endTime 结束时间戳
 * @returns {number} 总流量
 */
function calculateTrafficInRange(trafficData, startTime, endTime) {
    if (!trafficData || !Array.isArray(trafficData)) return 0;
    
    let totalTraffic = 0;
    const now = Math.floor(Date.now() / 1000);
    
    for (const record of trafficData) {
        if (Array.isArray(record) && record.length >= 2) {
            const inbound = validateTrafficValue(record[0]);
            const outbound = validateTrafficValue(record[1]);
            totalTraffic += inbound + outbound;
        }
    }
    
    return totalTraffic;
}

/**
 * 计算上一个流量重置日期
 * @param {Date} now 当前日期
 * @param {number} resetDay 重置日
 * @returns {Date} 上一个重置日期
 */
function calculateLastResetDate(now, resetDay) {
    const lastReset = new Date(now.getFullYear(), now.getMonth(), resetDay);
    
    // 如果重置日期在当前日期之后，回退到上个月
    if (lastReset > now) {
        lastReset.setMonth(lastReset.getMonth() - 1);
    }
    
    lastReset.setHours(0, 0, 0, 0);
    return lastReset;
}

/**
 * 计算已用流量
 * @param {Object} params 计算参数
 * @param {Array} params.trafficData ds数据数组 [[入站,出站,时间戳],...]
 * @param {number} params.resetDay 重置日
 * @param {number} params.calibrationDate 校准日期
 * @param {number} params.calibrationValue 校准值(bytes)
 * @returns {number} 已用流量(GB)
 */
function calculateUsedTraffic({trafficData, resetDay, calibrationDate, calibrationValue}) {
    console.log('[Traffic Utils] 计算已用流量, 参数:', {
        trafficDataLength: trafficData?.length,
        resetDay,
        calibrationDate,
        calibrationValue,
        calibrationValueGB: calibrationValue / (1024 * 1024 * 1024),
        trafficDataSample: trafficData?.[trafficData?.length - 1]
    });

    // 1. 验证输入
    if (!Array.isArray(trafficData) || trafficData.length === 0) {
        console.warn('[Traffic Utils] trafficData无效');
        return 0;
    }
    
    // 2. 计算重置日期
    const now = new Date();
    const lastResetDate = calculateLastResetDate(now, resetDay);
    const lastResetTimestamp = Math.floor(lastResetDate.getTime() / 1000);
    console.log('[Traffic Utils] 上次重置日期:', lastResetDate);
    
    // 3. 初始化总流量
    let totalBytes = 0;
    
    // 4. 处理流量数据
    if (calibrationDate && calibrationDate > lastResetTimestamp) {
        // 4.1 如果有校准值且在重置日期之后
        // calibrationValue 已经是字节单位，直接使用
        totalBytes = calibrationValue;
        
        // 只累加校准日期之后的流量
        for (const record of trafficData) {
            if (Array.isArray(record) && record.length >= 3) {
                const timestamp = record[2];
                if (timestamp > calibrationDate) {
                    const inbound = validateTrafficValue(record[0]);
                    const outbound = validateTrafficValue(record[1]);
                    totalBytes += (inbound + outbound);
                }
            }
        }
    } else {
        // 4.2 如果没有校准值或校准日期在重置日期之前
        // 累加重置日期之后的所有流量
        for (const record of trafficData) {
            if (Array.isArray(record) && record.length >= 3) {
                const timestamp = record[2];
                if (timestamp > lastResetTimestamp) {
                    const inbound = validateTrafficValue(record[0]);
                    const outbound = validateTrafficValue(record[1]);
                    totalBytes += (inbound + outbound);
                }
            }
        }
    }
    
    // 5. 将字节转换为GB并保留两位小数
    const totalTrafficGB = Number((totalBytes / (1024 * 1024 * 1024)).toFixed(2));
    
    console.log('[Traffic Utils] 流量计算结果:', {
        totalBytes,
        totalTrafficGB,
        formatted: formatTraffic(totalBytes)
    });
    
    return totalTrafficGB;
}

/**
 * 计算剩余流量
 * @param {Object} params 计算参数
 * @param {number} params.used 已用流量
 * @param {number} params.limit 流量限制
 * @returns {number} 剩余流量，-1表示无限制
 */
function calculateRemainingTraffic({used, limit}) {
    const usedTraffic = Math.max(0, Number(used) || 0);
    const trafficLimit = Math.max(0, Number(limit) || 0);
    
    if (!trafficLimit) return -1;  // 无限制返回-1
    return Math.max(0, trafficLimit - usedTraffic);
}

/**
 * 计算流量使用百分比
 * @param {number} used 已用流量
 * @param {number} limit 流量限制
 * @returns {number} 流量使用百分比
 */
function calculateTrafficUsageRatio(used, limit) {
    if (limit === 0) return 0;
    return Math.min(100, Math.max(0, (used / limit) * 100));
}

/**
 * 格式化流量使用百分比
 * @param {number} used 已用流量
 * @param {number} limit 流量限制
 * @returns {string} 格式化的流量使用百分比
 */
function formatPercentage(used, limit) {
    const ratio = calculateTrafficUsageRatio(used, limit);
    return `${ratio.toFixed(2)}%`;
}