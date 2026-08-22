// storage/json/auth.js - JSON file-based auth storage (async contract)
const fs = require('fs');
const path = require('path');
const { atomicWriteFileSync } = require('../../util');
const { DEFAULT_AUTH } = require('../auth-defaults');

const AUTH_PATH = path.join(__dirname, '..', '..', '..', 'config', 'auth.json');

async function readAuthConfig() {
    try {
        if (!fs.existsSync(AUTH_PATH)) return null;
        const data = fs.readFileSync(AUTH_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading auth config:', error);
        return null;
    }
}

async function writeAuthConfig(data) {
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

async function initAuthConfig() {
    const configDir = path.dirname(AUTH_PATH);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }

    if (!fs.existsSync(AUTH_PATH)) {
        atomicWriteFileSync(AUTH_PATH, JSON.stringify(DEFAULT_AUTH, null, 2));
        console.log('Created new auth config file');
    }
}

module.exports = { readAuthConfig, writeAuthConfig, initAuthConfig };
