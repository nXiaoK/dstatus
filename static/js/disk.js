// ---------------------------------------------------------
// 1) 解析后端注入的 “过去60分钟 / 24小时” 数据
// ---------------------------------------------------------
const disk_m = safeParseJSON('disk_m_data', []); // <textarea id="disk_m_data">
const disk_h = safeParseJSON('disk_h_data', []); // <textarea id="disk_h_data">

/**
 * 过去60分钟磁盘带宽数据
 * 假设后端每分钟一条 => 最多60个点
 */
const diskMinuteData = {
  read: [],
  write: [],
  labels: []
};

/**
 * 过去24小时磁盘带宽数据
 * 假设后端每小时一条 => 最多24个点
 */
const diskHourData = {
  read: [],
  write: [],
  labels: []
};

// 解析 60分钟数据
for (const data of disk_m) {
    if (!data) continue;
    // 后端返回结构可能是 { read, write, timestamp } 
    // 也可能是 readRate, writeRate, 具体字段名称你自己定
    const { read = -1, write = -1 } = data;
    
    // 保证 -1 的变成 0
    const safeRead = (read === -1 ? 0 : Number(read));
    const safeWrite = (write === -1 ? 0 : Number(write));
    
    diskMinuteData.read.push(safeRead);
    diskMinuteData.write.push(safeWrite);
  }
// 若数据少于 60 条，则用 0 补足
while (diskMinuteData.read.length < 60) {
    diskMinuteData.read.push(0);
    diskMinuteData.write.push(0);
  }
// 生成 60 分钟的时间标签
// 参考 load.js 里对 minuteData.labels 的做法
const nowMinute = new Date();
for (let i = 0; i < 60; i++) {
  try {
    const time = new Date(nowMinute);
    time.setMinutes(time.getMinutes() - i);
    // 格式形如 HH:mm
    diskMinuteData.labels.push(time.Format('HH:mm'));
  } catch (e) {
    console.error('Error generating disk minute label:', e);
    diskMinuteData.labels.push('--:--');
  }
}
// 反转，使得最早的在前，最新的在末
diskMinuteData.labels.reverse();
// --------------------------------------------------------
// 3. 处理 24小时 数据 (如同 load_h_data 的处理)
// --------------------------------------------------------
for (const data of disk_h) {
    if (!data) continue;
    // 假设结构同上
    const { read = -1, write = -1 } = data;
    
    const safeRead = (read === -1 ? 0 : Number(read));
    const safeWrite = (write === -1 ? 0 : Number(write));
    
    diskHourData.read.push(safeRead);
    diskHourData.write.push(safeWrite);
  }
  
  // 若数据少于 24 条，则用 0 补足
  while (diskHourData.read.length < 24) {
    diskHourData.read.push(0);
    diskHourData.write.push(0);
  }
  
  // 生成 24 小时时间标签
  const nowHour = new Date();
  for (let i = 0; i < 24; i++) {
    try {
      const time = new Date(nowHour);
      time.setHours(time.getHours() - i);
      // 格式形如 HH:00
      diskHourData.labels.push(time.Format('HH:00'));
    } catch (e) {
      console.error('Error generating disk hour label:', e);
      diskHourData.labels.push('--:--');
    }
  }
  diskHourData.labels.reverse();
// ---------------------------------------------------------
// 2) 定义 “3分钟” 实时磁盘带宽数据
// ---------------------------------------------------------
/**
 * diskRealtimeData: 每2秒采样 => 90个点 => 3分钟
 */
const diskRealtimeData = {
  read: new Array(90).fill(0),
  write: new Array(90).fill(0),
  labels: new Array(90).fill('')
};

/**
 * 初始化 3 分钟磁盘带宽的时间标签
 * 每隔2秒一个点 => 90点 => 180秒(3分钟)
 * 每10秒显示一次标签
 */
function initDiskRealtimeLabels() {
  for (let i = 0; i < 90; i++) {
    const seconds = 180 - i * 2; // 3分钟=180秒
    if (i === 89) {
      diskRealtimeData.labels[i] = '最新';
    } else if (seconds % 10 === 0) {
      diskRealtimeData.labels[i] = `${seconds}s`;
    } else {
      diskRealtimeData.labels[i] = '';
    }
  }
}

// ---------------------------------------------------------
// 3) 创建 ApexCharts 图表
// ---------------------------------------------------------
/**
 * 创建“3分钟实时”磁盘带宽图表
 */
function createRealtimeDiskChart() {
  const timeLabels = diskRealtimeData.labels; // 已经 initDiskRealtimeLabels() 过
  
  return new ApexCharts(
    document.querySelector("#disk-realtime-chart"),
    createRealtimeChartOptions(
      {
        read: diskRealtimeData.read,
        write: diskRealtimeData.write,
        labels: timeLabels
      },
      timeLabels,
      {
        type: 'area',
        colors: ['#0284c7', '#0ea5e9'], // 两种蓝色
        series: [
          { name: '读', data: diskRealtimeData.read },
          { name: '写', data: diskRealtimeData.write }
        ],
        yaxisFormatter: (val) => {
          if (!isFinite(val)) return '0 B/s';
          return strbps(val);
        },
        additional: {
          fill: {
            type: 'gradient',
            gradient: {
              shadeIntensity: 1,
              opacityFrom: 0.35,
              opacityTo: 0.05,
              stops: [0, 95, 100]
            }
          },
          title: {
            text: '实时磁盘IO (3分钟)',
            align: 'left',
            style: {
              fontSize: '14px',
              color: '#64748b'
            }
          }
        }
      }
    )
  );
}

/**
 * 创建 “过去60分钟” 磁盘带宽图表
 */
function createDiskMinuteChart() {
  return new ApexCharts(
    document.querySelector("#disk-60m-chart"),
    {
      ...baseChartOptions,
      chart: {
        ...baseChartOptions.chart,
        type: 'area'
      },
      series: [
        { name: '读', data: diskMinuteData.read },
        { name: '写', data: diskMinuteData.write }
      ],
      xaxis: {
        categories: diskMinuteData.labels,
        labels: {
          style: { colors: '#94a3b8' }
        }
      },
      yaxis: {
        labels: {
          formatter: (val) => strbps(val),
          style: { colors: '#94a3b8' }
        }
      },
      title: {
        text: '过去60分钟磁盘IO',
        align: 'left',
        style: { fontSize: '14px', color: '#64748b' }
      }
    }
  );
}

/**
 * 创建 “过去24小时” 磁盘带宽图表
 */
function createDiskHourChart() {
  return new ApexCharts(
    document.querySelector("#disk-24h-chart"),
    {
      ...baseChartOptions,
      chart: {
        ...baseChartOptions.chart,
        type: 'area'
      },
      series: [
        { name: '读', data: diskHourData.read },
        { name: '写', data: diskHourData.write }
      ],
      xaxis: {
        categories: diskHourData.labels,
        labels: {
          style: { colors: '#94a3b8' }
        }
      },
      yaxis: {
        labels: {
          formatter: (val) => strbps(val),
          style: { colors: '#94a3b8' }
        }
      },
      title: {
        text: '过去24小时磁盘IO',
        align: 'left',
        style: { fontSize: '14px', color: '#64748b' }
      }
    }
  );
}

// ---------------------------------------------------------
// 4) 实时更新函数 (在 stat.js/其它逻辑中调用)
// ---------------------------------------------------------
/**
 * 更新 “3分钟实时” 磁盘带宽数据
 * @param {Object} disk - 后端返回的 disk 对象, 例如:
 *   {
 *     devices: {
 *       "/": {read_rate: 1234, write_rate: 5678, ...},
 *       ...
 *     }
 *   }
 */
function updateDiskRealtime(disk) {
  if (!disk || !disk.devices) return;

  // 累加全部分区的 read_rate / write_rate
  let totalRead = 0;
  let totalWrite = 0;
  for (const mount in disk.devices) {
    const dev = disk.devices[mount];
    if (dev.read_rate) totalRead += dev.read_rate;
    if (dev.write_rate) totalWrite += dev.write_rate;
  }

  // 1) 移除最旧值
  diskRealtimeData.read.shift();
  diskRealtimeData.write.shift();

  // 2) 追加最新值
  diskRealtimeData.read.push(totalRead);
  diskRealtimeData.write.push(totalWrite);

  // 3) 更新图表
  if (diskChartRealtime) {
    diskChartRealtime.updateOptions({
      series: [
        { name: '读', data: diskRealtimeData.read },
        { name: '写', data: diskRealtimeData.write }
      ]
    });
  }
}

// ---------------------------------------------------------
// 5) DOMContentLoaded: 初始化图表并渲染
// ---------------------------------------------------------
let diskChartRealtime, diskChartMinute, diskChartHour;

document.addEventListener('DOMContentLoaded', () => {
  // 初始化 3分钟实时带宽的时间标签
  initDiskRealtimeLabels();

  // 创建并渲染3个图表
  diskChartRealtime = createRealtimeDiskChart();
  diskChartMinute = createDiskMinuteChart();
  diskChartHour = createDiskHourChart();

  diskChartRealtime.render();
  diskChartMinute.render();
  diskChartHour.render();
});