const ssh = require("../../ssh");
const { decrypt } = require('./cryptoUtil');
async function initServer(server, neko_status_url) {
    // 解密密码
    if (server.data && server.data.ssh && server.data.ssh.password) {
        try {
            server.data.ssh.password = decrypt(server.data.ssh.password);
        } catch (err) {
            console.error('解密SSH密码失败:', err);
            server.data.ssh.password = '';
        }
    }
    var sh =
        `wget --version||yum install wget -y||apt-get install wget -y
/usr/bin/node-status -v||(wget ${neko_status_url} -O /usr/bin/node-status && chmod +x /usr/bin/node-status)
systemctl stop nodestatus
mkdir /etc/node-status/
echo "key: ${server.data.api.key}
port: ${server.data.api.port}
debug: false" > /etc/node-status/config.yaml
systemctl stop nodestatus
echo "[Unit]
Description=nodestatus

[Service]
Restart=always
RestartSec=5
ExecStart=/usr/bin/node-status -c /etc/node-status/config.yaml

[Install]
WantedBy=multi-user.target" > /etc/systemd/system/nodestatus.service
systemctl daemon-reload
systemctl start nodestatus
systemctl enable nodestatus`
    var res = await ssh.Exec(server.data.ssh, sh);
    if (res.success) return { status: 1, data: "安装成功" };
    else return { status: 0, data: "安装失败/SSH连接失败" };
}
async function updateServer(server, neko_status_url) {
    // 解密密码
    if (server.data && server.data.ssh && server.data.ssh.password) {
        try {
            server.data.ssh.password = decrypt(server.data.ssh.password);
        } catch (err) {
            console.error('解密SSH密码失败:', err);
            server.data.ssh.password = '';
        }
    }
    var sh =
        `rm -f /usr/bin/node-status
wget ${neko_status_url} -O /usr/bin/node-status
chmod +x /usr/bin/node-status
systemctl restart nodestatus`
    await ssh.Exec(server.data.ssh, sh);
    return { status: 1, data: "更新成功" };
}
module.exports = {
    initServer, updateServer,
}
