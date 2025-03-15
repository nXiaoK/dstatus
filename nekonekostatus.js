#!/usr/bin/env node
"use strict"
const express=require('express'),
    bp=require('body-parser'),
    ckp=require("cookie-parser"),
    nunjucks=require("nunjucks"),
    fs=require("fs"),
    fileUpload=require('express-fileupload'),
    schedule=require("node-schedule");
const core=require("./core"),
    db=require("./database/index")(),
    {pr,md5,uuid}=core;
var setting=db.setting.all();
var svr=express();

svr.use(bp.urlencoded({extended: false}));
svr.use(bp.json({limit:'100mb'}));
svr.use(ckp());
svr.use(express.json());
svr.use(express.static(__dirname+"/static"));

// 添加设备检测中间件
svr.use((req, res, next) => {
    const userAgent = req.headers['user-agent'] || '';
    req.isMobile = /Mobile|Android|iPhone|iPad|iPod/i.test(userAgent);
    next();
});

// 添加文件上传中间件
svr.use(fileUpload({
    createParentPath: true,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB限制
    abortOnLimit: true
}));

svr.engine('html', nunjucks.render);
svr.set('view engine', 'html');
require('express-ws')(svr);

var env=nunjucks.configure(__dirname+'/views', {
    autoescape: true,
    express: svr,
    watch:setting.debug,
});

// 添加自定义过滤器
env.addFilter('date', function(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
});

env.addFilter('formatDate', function(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    return date.toISOString().split('T')[0];
});

env.addFilter('bytesToGB', function(bytes) {
    if (!bytes) return '0';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2);
});

env.addFilter('formatTimestamp', function(timestamp) {
    if (!timestamp) return '未校准';
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
});

// 添加格式化百分比的过滤器
env.addFilter('formatPercentage', function(used, limit) {
    if (!limit || limit <= 0) return '0%';
    return ((used / limit * 100) || 0).toFixed(1) + '%';
});

var admin_tokens=new Set();
try{for(var token of require("./tokens.json"))admin_tokens.add(token);}catch{}
setInterval(()=>{
    var tokens=[];
    for(var token of admin_tokens.keys())tokens.push(token);
    fs.writeFileSync(__dirname+"/tokens.json",JSON.stringify(tokens));
},1000);
svr.all('*',(req,res,nxt)=>{
    if(admin_tokens.has(req.cookies.token))req.admin=true;
    nxt();
});
svr.get('/login',(req,res)=>{
    if(req.admin)res.redirect('/');
    else res.render('login',{});
});
svr.post('/login',(req,res)=>{
    var {password}=req.body;
    if(password==md5(db.setting.get("password"))){
        var token=uuid.v4();
        admin_tokens.add(token);
        res.cookie("token",token);
        res.json(pr(1,token));
    }
    else res.json(pr(0,"密码错误"));
});
svr.get('/logout',(req,res)=>{
    admin_tokens.delete(req.cookies.token);
    res.clearCookie("token");
    res.redirect("/login");
});
svr.all('/admin*',(req,res,nxt)=>{
    if(req.admin)nxt();
    else res.redirect('/login');
});


// 设置全局变量
svr.locals={
    setting,
    db,
    bot,
    ...core,
};

// WebSocket连接管理
const wsClients = new Map(); // 存储WebSocket连接
const MAX_CONNECTIONS_PER_IP = 30; // 每个IP最大连接数
const UPDATE_INTERVAL = 1500; // 更新频率(ms)

// 添加WebSocket路由
svr.ws('/ws/stats', function(ws, req) {
    // 1. 安全性验证
    const isAdmin = admin_tokens.has(req.cookies.token);
    const clientIP = req.ip;
    
    // 2. 连接数量限制
    if(wsClients.has(clientIP)) {
        const existingConnections = wsClients.get(clientIP);
        if(existingConnections >= MAX_CONNECTIONS_PER_IP) {
            // console.log(`[${new Date().toISOString()}] 连接被拒绝 - IP:${clientIP} 超出最大连接数`);
            ws.close();
            return;
        }
        wsClients.set(clientIP, existingConnections + 1);
    } else {
        wsClients.set(clientIP, 1);
    }
    
    console.log(`[${new Date().toISOString()}] WebSocket连接建立 - 管理员:${isAdmin} IP:${clientIP}`);
    
    // 3. 数据发送定时器
    const timer = setInterval(() => {
        try {
            if (ws.readyState === ws.OPEN && svr.locals.stats) {
                // 获取完整数据
                const statsData = svr.locals.stats.getStatsData(isAdmin, true);
                
                // 数据完整性检查
                if (!statsData || typeof statsData !== 'object') {
                    console.error(`[${new Date().toISOString()}] 无效的统计数据 - IP:${clientIP}`);
                    return;
                }

                const message = {
                    type: 'stats',
                    timestamp: Date.now(),
                    data: statsData
                };

                // 添加调试日志
                if (setting.debug) {
                    console.debug(`[${new Date().toISOString()}] 发送数据 - IP:${clientIP} 数据大小:${JSON.stringify(message).length} 节点数:${Object.keys(message.data).length}`);
                }
                
                // 检查WebSocket状态并发送数据
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify(message));
                } else {
                    console.warn(`[${new Date().toISOString()}] WebSocket未连接 - IP:${clientIP}`);
                }
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] WebSocket数据发送错误 - IP:${clientIP}:`, error);
        }
    }, UPDATE_INTERVAL);
    
    // 4. 连接关闭处理
    ws.on('close', () => {
        clearInterval(timer);
        // 清理连接计数
        const count = wsClients.get(clientIP);
        if(count <= 1) {
            wsClients.delete(clientIP);
        } else {
            wsClients.set(clientIP, count - 1);
        }
        // console.log(`[${new Date().toISOString()}] WebSocket连接关闭 - IP:${clientIP}`);
    });
    
    // 5. 错误处理
    ws.on('error', (error) => {
        console.error(`[${new Date().toISOString()}] WebSocket错误 - IP:${clientIP}:`, error);
        clearInterval(timer);
        // 清理连接计数
        const count = wsClients.get(clientIP);
        if(count <= 1) {
            wsClients.delete(clientIP);
        } else {
            wsClients.set(clientIP, count - 1);
        }
    });
});

// 加载admin模块
require('./modules/admin')(svr);
require('./modules/restart')(svr);  // 加载重启模块

var bot=null;
if(setting.bot&&setting.bot.token){
    bot=require("./bot")(setting.bot.token,setting.bot.chatIds);
    if(setting.bot.webhook){
        bot.bot.setWebHook(setting.site.url+"/bot"+setting.bot.token).then(()=>{
            bot.bot.setMyCommands(bot.cmds);
        });
        svr.all('/bot'+setting.bot.token, (req,res)=>{
            bot.bot.processUpdate(req.body);
            res.sendStatus(200);
        });
    }
    else bot.bot.startPolling();
}

fs.readdirSync(__dirname+'/modules',{withFileTypes:1}).forEach(file=>{
    if(!file.isDirectory())return;
    try{require(`./modules/${file.name}/index.js`)(svr);}catch(e){console.log(e)}
});
const port=process.env.PORT||db.setting.get("listen"),host=process.env.HOST||'';
svr.server=svr.listen(port,host,()=>{console.log(`server running @ http://${host ? host : 'localhost'}:${port}`);})

// 添加主页路由处理
svr.get('/', (req, res) => {
    try {
        // 获取用户偏好主题
        let theme = req.query.theme || req.cookies.theme;
        const isAdmin = req.admin;
        
        // 如果是移动设备且没有明确指定主题或保存的偏好，默认使用列表视图
        if (req.isMobile && !theme) {
            theme = 'list';
        }
        
        // 如果还没有主题，使用系统默认主题
        theme = theme || setting.theme || 'card';
        
        console.log(`[${new Date().toISOString()}] 主页请求 - 主题:${theme} 管理员:${isAdmin} 移动端:${req.isMobile}`);
        
        // 渲染对应视图
        res.render(`stats/${theme}`, {
            stats: svr.locals.stats ? svr.locals.stats.getStatsData(isAdmin) : {},
            groups: db.groups.getWithCount(),
            theme,
            admin: isAdmin,
            setting
        });
    } catch (error) {
        console.error('主页渲染错误:', error);
        res.status(500).send('服务器内部错误');
    }
});