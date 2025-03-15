package stat

import (
	"neko-status/walled"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shirou/gopsutil/cpu"
	"github.com/shirou/gopsutil/disk"
	"github.com/shirou/gopsutil/host"
	"github.com/shirou/gopsutil/mem"
	"github.com/shirou/gopsutil/net"
)

func GetStat() (map[string]interface{}, error) {
	timer := time.NewTimer(1 * time.Second)
	res := gin.H{
		"walled": walled.Walled,
	}
	CPU1, err := cpu.Times(true)
	if err != nil {
		return nil, err
	}
	NET1, err := net.IOCounters(true)
	if err != nil {
		return nil, err
	}
	// 新增：第一次采样硬盘 IO
	IO1, err := disk.IOCounters()
	if err != nil {
		return nil, err
	}
	<-timer.C
	CPU2, err := cpu.Times(true)
	if err != nil {
		return nil, err
	}
	NET2, err := net.IOCounters(true)
	if err != nil {
		return nil, err
	}
	// 新增：第二次采样硬盘 IO
	IO2, err := disk.IOCounters()
	if err != nil {
		return nil, err
	}
	MEM, err := mem.VirtualMemory()
	if err != nil {
		return nil, err
	}
	SWAP, err := mem.SwapMemory()
	if err != nil {
		return nil, err
	}
	res["mem"] = gin.H{
		"virtual": MEM,
		"swap":    SWAP,
	}
	partitions, err := disk.Partitions(true)
	if err != nil {
		return nil, err
	}
	// 准备一个存储 “多分区” 数据的 map
	diskDevices := gin.H{}

	// 遍历每个分区
	for _, p := range partitions {
		deviceName := p.Device
		if strings.HasPrefix(deviceName, "/dev/") {
			deviceName = strings.TrimPrefix(deviceName, "/dev/")
		}
		// 可选：先排除特定 fstype
		skipFSTypes := map[string]bool{
			"tmpfs":           true,
			"devtmpfs":        true,
			"proc":            true,
			"devpts":          true,
			"sysfs":           true,
			"cgroup":          true,
			"cgroup2":         true,
			"mqueue":          true,
			"fusectl":         true,
			"hugetlbfs":       true,
			"securityfs":      true,
			"pstore":          true,
			"debugfs":         true,
			"tracefs":         true,
			"efivarfs":        true,
			"ramfs":           true,
			"vfat":            true,
			"binfmt_misc":     true,
			"fuse.prl_fsd":    true,
			"fuse.portal":     true,
			"fuse.gvfsd-fuse": true,
			"bpf":             true,
			"configfs":        true,
			"autofs":          true,
			"overlay":         true,
			// ... 其他你不想统计的类型
		}
		if skipFSTypes[p.Fstype] {
			continue
		}
		usage, err := disk.Usage(p.Mountpoint)
		if err != nil {
			continue
		}

		// 再用去掉 "/dev/" 前缀后的 deviceName 做匹配
		io1, ok1 := IO1[deviceName]
		io2, ok2 := IO2[deviceName]

		var readRate float64
		var writeRate float64
		if ok1 && ok2 {
			// 单位：B/s
			readRate = float64(io2.ReadBytes-io1.ReadBytes) / 1
			writeRate = float64(io2.WriteBytes-io1.WriteBytes) / 1
		}

		// <-- 在这里添加日志输出 -->
		// log.Printf("[DEBUG] Partition: %s (device: %s), readRate=%.2f B/s, writeRate=%.2f B/s, readBytes=%d, writeBytes=%d",
		// 	p.Mountpoint, p.Device,
		// 	readRate, writeRate,
		// 	io2.ReadBytes, io2.WriteBytes,
		// )
		// 记录分区信息
		diskDevices[p.Mountpoint] = gin.H{
			"device":      p.Device,
			"fstype":      p.Fstype,
			"mountpoint":  p.Mountpoint,
			"total":       usage.Total,
			"used":        usage.Used,
			"free":        usage.Free,
			"usedPercent": usage.UsedPercent,
			"read_rate":   readRate,
			"write_rate":  writeRate,
		}
	}

	// 把整合后的结果放到返回值
	res["disk"] = gin.H{
		"devices": diskDevices,
	}

	single := make([]float64, len(CPU1))
	var idle, total, multi float64
	idle, total = 0, 0
	for i, c1 := range CPU1 {
		c2 := CPU2[i]
		single[i] = 1 - (c2.Idle-c1.Idle)/(c2.Total()-c1.Total())
		idle += c2.Idle - c1.Idle
		total += c2.Total() - c1.Total()
	}
	multi = 1 - idle/total
	// info, err := cpu.Info()
	// if err != nil {
	// 	return nil, err
	// }
	res["cpu"] = gin.H{
		// "info":   info,
		"multi":  multi,
		"single": single,
	}

	var in, out, in_total, out_total uint64
	in, out, in_total, out_total = 0, 0, 0, 0
	res["net"] = gin.H{
		"devices": gin.H{},
	}
	for i, x := range NET2 {
		_in := x.BytesRecv - NET1[i].BytesRecv
		_out := x.BytesSent - NET1[i].BytesSent
		res["net"].(gin.H)["devices"].(gin.H)[x.Name] = gin.H{
			"delta": gin.H{
				"in":  float64(_in) / 1,
				"out": float64(_out) / 1,
			},
			"total": gin.H{
				"in":  x.BytesRecv,
				"out": x.BytesSent,
			},
		}
		if x.Name == "lo" {
			continue
		}
		in += _in
		out += _out
		in_total += x.BytesRecv
		out_total += x.BytesSent
	}
	res["net"].(gin.H)["delta"] = gin.H{
		"in":  float64(in) / 1,
		"out": float64(out) / 1,
	}
	res["net"].(gin.H)["total"] = gin.H{
		"in":  in_total,
		"out": out_total,
	}
	host, err := host.Info()
	if err != nil {
		return nil, err
	}
	res["host"] = host
	// 新增：获取服务器在线时间(即系统已运行时间)
	uptimeSec := host.Uptime
	res["uptime"] = uptimeSec

	return res, nil
}
