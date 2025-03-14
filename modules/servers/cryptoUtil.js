// cryptoUtil.js
const crypto = require("crypto");

// 使用环境变量或配置文件存储密钥更安全
const ENC_KEY = 'zBV2KJ7KD!VysmIY9!cK851mjvFzrcaO'; // 32字节密钥
const IV = 'pv$uz*XvdN#Pt#1T'; // 16字节IV

function encrypt(text) {
    const cipher = crypto.createCipheriv('aes-256-cbc', ENC_KEY, IV);
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
}

function decrypt(encryptedText) {
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENC_KEY, IV);
    let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

module.exports = { encrypt, decrypt };