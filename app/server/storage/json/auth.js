// storage/json/auth.js - JSON file-based auth storage
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { atomicWriteFileSync } = require('../../util');

const AUTH_PATH = path.join(__dirname, '..', '..', '..', 'config', 'auth.json');

function readAuthConfig() {
    try {
        if (!fs.existsSync(AUTH_PATH)) return null;
        const data = fs.readFileSync(AUTH_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading auth config:', error);
        return null;
    }
}

function writeAuthConfig(data) {
    try {
        const configDir = path.dirname(AUTH_PATH);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        atomicWriteFileSync(AUTH_PATH, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing auth config:', error);
        return false;
    }
}

function initAuthConfig() {
    const configDir = path.dirname(AUTH_PATH);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }

    if (!fs.existsSync(AUTH_PATH)) {
        const defaultAuth = {
            admin: {
                id: "admin_001",
                username: "SuperAdmin",
                password: bcrypt.hashSync('Admin123', 10),
                role: "superadmin",
                createdAt: new Date().toISOString()
            },
            moderators: [],
            settings: {
                allowModeratorRegistration: true,
                maxGroups: 6,
                defaultModPassword: "Admin123",
                discordWebhook: "",
                historyLimit: 100
            }
        };
        atomicWriteFileSync(AUTH_PATH, JSON.stringify(defaultAuth, null, 2));
        console.log('Created new auth config file');
    }
}

module.exports = { readAuthConfig, writeAuthConfig, initAuthConfig };
