const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const schedule = require('node-schedule');

// 格式化时间为人类可读格式
function formatDateTime(date = new Date()) {
    return date.toISOString().replace(/[T:]/g, '-').slice(0, 19);
}

module.exports = function(app) {
    let { db, pr } = app.locals;  // 使用 let 而不是 const，因为需要重新赋值
    
    // 数据库备份
    router.get('/db/backup', async (req, res) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(process.cwd(), 'database', `backup-${timestamp}.db.db`);
        
       //  console.log('===== 数据库备份开始 =====');
       //  console.log('时间:', new Date().toLocaleString());
       //  console.log('用户IP:', req.ip);
       //  console.log('备份路径:', backupPath);
        
        try {
            // 确保备份目录存在
            const backupDir = path.dirname(backupPath);
            if (!fs.existsSync(backupDir)) {
                console.log('创建备份目录:', backupDir);
                fs.mkdirSync(backupDir, { recursive: true });
            }

            // 获取原始数据库大小
            const dbSize = fs.statSync(path.join(process.cwd(), 'database', 'db.db')).size;
           //  console.log('原始数据库大小:', (dbSize / 1024 / 1024).toFixed(2) + 'MB');

            // 创建备份
         //    console.log('开始创建备份文件...');
            await db.DB.backup(backupPath);
            
            // 获取备份文件大小
            const backupSize = fs.statSync(backupPath).size;
          //   console.log('备份文件创建成功');
          //   console.log('备份文件大小:', (backupSize / 1024 / 1024).toFixed(2) + 'MB');

            // 发送文件并在发送后删除
         //    console.log('开始发送备份文件...');
            res.download(backupPath, `dstatus-backup-${timestamp}.db.db`, (err) => {
                if (err) {
                    console.error('下载过程出错:', err);
                    console.log('===== 数据库备份失败 =====\n');
                } else {
                    console.log('文件发送成功');
                    console.log('===== 数据库备份完成 =====\n');
                }
                // 删除临时文件
                fs.unlink(backupPath, (unlinkErr) => {
                    if (unlinkErr) {
                        console.error('清理临时文件失败:', unlinkErr);
                    } else {
                        console.log('临时文件已清理:', backupPath);
                    }
                });
            });
        } catch (error) {
            console.error('备份过程出错:', error);
            console.log('===== 数据库备份失败 =====\n');
            res.status(500).json(pr(0, '备份失败: ' + error.message));
        }
    });

    // 数据库恢复
    router.post('/db/restore', async (req, res) => {
        try {
            // 检查文件上传
            if (!req.files) {
                console.error('没有文件被上传:', req.files);
                return res.json(pr(0, "未检测到上传的文件"));
            }
            
            if (!req.files.database) {
                console.error('找不到database字段:', Object.keys(req.files));
                return res.json(pr(0, "请选择数据库文件"));
            }
            
            const file = req.files.database;
            console.log('文件上传信息:', {
                name: file.name,
                size: file.size,
                mimetype: file.mimetype,
                tempFilePath: file.tempFilePath,
                md5: file.md5
            });
            
            // 验证文件基本信息
            if (!file.name.endsWith('.db')) {
                return res.json(pr(0, "请上传.db格式的数据库文件"));
            }
            
            if (file.size === 0) {
                return res.json(pr(0, "上传的文件为空"));
            }
            
            const dbPath = path.join(process.cwd(), 'database', 'db.db');
            const backupPath = path.join(process.cwd(), 'database', `backup-before-restore-${formatDateTime()}.db.db`);
            
            // 确保临时文件存在
            if (!file.tempFilePath || !fs.existsSync(file.tempFilePath)) {
                console.error('临时文件不存在或路径为空');
                console.log('尝试使用mv方法移动文件...');
                
                const tempPath = path.join(process.cwd(), 'database', `temp-${Date.now()}.db`);
                await file.mv(tempPath);
                file.tempFilePath = tempPath;
                
                console.log('文件已移动到:', tempPath);
            }

            // 1. 验证上传的文件
            let testDb;
            try {
                // 检查文件信息
                console.log('上传文件信息:', {
                    name: file.name,
                    size: file.size,
                    tempFilePath: file.tempFilePath,
                    mimetype: file.mimetype
                });
                
                // 检查临时文件
                if (!fs.existsSync(file.tempFilePath)) {
                    throw new Error('临时文件不存在: ' + file.tempFilePath);
                }
                
                const stats = fs.statSync(file.tempFilePath);
                // console.log('临时文件状态:', {
                //     size: stats.size,
                //     mode: stats.mode,
                //     uid: stats.uid,
                //     gid: stats.gid
                // });
                
               //  console.log('开始验证数据库文件:', file.tempFilePath);
                testDb = new Database(file.tempFilePath, { verbose: console.log });
                
                // 获取所有表名
                const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
                // console.log('原始表信息:', tables);
                
                const tableNames = tables.map(t => t.name.toLowerCase());
                // console.log('发现的表:', tableNames.join(', '));
                
                // 1. 基本的表结构验证
                const requiredTables = [
                    {
                        name: 'servers',
                        requiredColumns: ['sid', 'name', 'data', 'status', 'group_id']
                    },
                    {
                        name: 'groups',
                        requiredColumns: ['id', 'name', 'top']
                    },
                    {
                        name: 'setting',
                        requiredColumns: ['key', 'val']
                    }
                ];
                
                // 2. 逐个验证表和字段
                for (const table of requiredTables) {
                    // 检查表是否存在（不区分大小写）
                    if (!tableNames.includes(table.name.toLowerCase())) {
                        throw new Error(`缺少必要的表: ${table.name}`);
                    }
                    
                    // 获取实际的表名（保持原始大小写）
                    const actualTableName = tables.find(
                        t => t.name.toLowerCase() === table.name.toLowerCase()
                    ).name;
                    
                    // 获取表结构
                    const columns = testDb.prepare(`PRAGMA table_info("${actualTableName}")`).all();
                    const columnNames = columns.map(c => c.name.toLowerCase());
                    
                    // 检查必要的字段（不区分大小写）
                    const missingColumns = table.requiredColumns.filter(
                        col => !columnNames.includes(col.toLowerCase())
                    );
                    
                    if (missingColumns.length > 0) {
                        throw new Error(
                            `表 ${actualTableName} 缺少必要的字段: ${missingColumns.join(', ')}`
                        );
                    }
                }
                
                // 3. 验证基本数据
                const serverCount = testDb.prepare('SELECT COUNT(*) as count FROM servers').get();
                const groupCount = testDb.prepare('SELECT COUNT(*) as count FROM groups').get();
                
                // console.log('数据验证结果:');
                // console.log('- 服务器数量:', serverCount.count);
                // console.log('- 分组数量:', groupCount.count);
                
                testDb.close();
                console.log('数据库验证成功');
            } catch (error) {
                console.error('数据库验证详细错误:', error);
                if (testDb) testDb.close();
                throw new Error('数据库验证失败: ' + error.message);
            }

            // 2. 备份当前数据库
            fs.copyFileSync(dbPath, backupPath);
            console.log('已创建当前数据库备份:', backupPath);

            // 3. 替换数据库文件
            fs.copyFileSync(file.tempFilePath, dbPath);
            console.log('已替换数据库文件');

            // 4. 发送成功响应，提示用户手动重启
            res.json(pr(1, "数据库恢复成功，请手动重启系统以使更改生效"));

            // 不再自动重启
        } catch (error) {
            console.error('恢复过程出错:', error);
            // 如果出错，尝试恢复备份
            if (fs.existsSync(backupPath)) {
                try {
                    fs.copyFileSync(backupPath, dbPath);
                    console.log('已恢复到备份数据库');
                } catch (restoreError) {
                    console.error('恢复备份失败:', restoreError);
                }
            }
            res.json(pr(0, error.message));
        }
    });

    // 定期清理临时文件（每天凌晨执行）
    schedule.scheduleJob('0 0 * * *', () => {
        const backupDir = path.join(process.cwd(), 'database');
        fs.readdir(backupDir, (err, files) => {
            if (err) return;
            const now = Date.now();
            files.forEach(file => {
                // 清理超过24小时的临时文件和备份文件（.db.db扩展名）
                if ((file.startsWith('temp-') || file.startsWith('backup-')) && file.endsWith('.db.db')) {
                    const filePath = path.join(backupDir, file);
                    fs.stat(filePath, (err, stats) => {
                        if (err) return;
                        if (now - stats.mtimeMs > 24 * 60 * 60 * 1000) {
                            fs.unlink(filePath, () => {});
                        }
                    });
                }
            });
        });
    });

    app.use('/admin', router);
}; 