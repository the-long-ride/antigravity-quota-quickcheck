import * as http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';

const execAsync = promisify(exec);

export interface QuotaData {
    model: string;
    percent: number;
    refreshTime: string;
}

export async function fetchRealQuota(): Promise<QuotaData[]> {
    const processData = await locateAntigravityBeacon();
    if (!processData) {
        throw new Error("Could not locate Antigravity language server process.");
    }
    
    const { pid, token } = processData;
    const port = await detectActivePort(pid);
    if (!port) {
        throw new Error("Could not detect Antigravity local port.");
    }

    const rawData = await queryServer(port, token);
    if (!rawData) {
        throw new Error("Failed to fetch data from Antigravity server.");
    }
    
    return parseQuotaData(rawData);
}

async function locateAntigravityBeacon(): Promise<{ pid: number; token: string } | null> {
    const os = platform();
    let output: string = '';

    try {
        if (os === 'win32') {
            const { stdout } = await execAsync(
                'powershell -NoProfile -Command "Get-CimInstance Win32_Process | ' +
                'Where-Object {$_.Name -like \'*language_server*\'} | ' +
                'Select-Object ProcessId,CommandLine | ConvertTo-Json"',
                { timeout: 8000 }
            );
            output = stdout;
        } else {
            const { stdout } = await execAsync(
                'ps -axo pid,args | grep -i language_server | grep -v grep',
                { timeout: 8000 }
            );
            output = stdout;
        }
    } catch {
        return null;
    }

    const tokenPattern = /--csrf[_-]?token[=\s]+([a-f0-9-]+)/ig;
    const extractToken = (text: string): string | null => {
        tokenPattern.lastIndex = 0;
        const match = tokenPattern.exec(text);
        return match ? match[1] : null;
    };

    if (os === 'win32') {
        try {
            const data = JSON.parse(output);
            const processes = Array.isArray(data) ? data : [data];

            for (const proc of processes) {
                const cmdLine = proc.CommandLine || '';
                const token = extractToken(cmdLine);
                const pid = Number(proc.ProcessId);
                if (token && pid > 0) {
                    return { pid, token };
                }
            }
        } catch {
            return null;
        }
    } else {
        const lines = output.trim().split('\n');
        for (const line of lines) {
            const token = extractToken(line);
            if (!token) continue;
            
            const pidMatch = line.trim().match(/^(\d+)/);
            if (pidMatch) {
                return { pid: parseInt(pidMatch[1], 10), token };
            }
        }
    }
    return null;
}

async function detectActivePort(pid: number): Promise<number | null> {
    const os = platform();
    let output: string = '';

    try {
        if (os === 'win32') {
            const { stdout } = await execAsync(
                `powershell -NoProfile -Command "Get-NetTCPConnection -OwningProcess ${pid} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort"`,
                { timeout: 5000 }
            );
            output = stdout;
        } else if (os === 'darwin') {
            const { stdout } = await execAsync(
                `lsof -iTCP -sTCP:LISTEN -a -p ${pid} -Fn 2>/dev/null | grep '^n' | sed 's/n\\*://'`,
                { timeout: 5000 }
            );
            output = stdout;
        } else {
            const { stdout } = await execAsync(
                `ss -tlnp 2>/dev/null | grep -F "pid=${pid}," | awk '{print $4}' | rev | cut -d: -f1 | rev`,
                { timeout: 5000 }
            );
            output = stdout;
        }
    } catch {
        return null;
    }

    const ports = output.split('\n').map(line => parseInt(line.trim(), 10)).filter(p => p > 0 && p < 65536);
    return ports.length > 0 ? ports[0] : null;
}

function queryServer(port: number, token: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            metadata: { ideName: 'antigravity' }
        });

        const req = http.request({
            hostname: '127.0.0.1',
            port,
            path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Connect-Protocol-Version': '1',
                'X-Codeium-Csrf-Token': token
            },
            timeout: 5000
        }, res => {
            if (res.statusCode !== 200) {
                let errData = '';
                res.on('data', chunk => errData += chunk);
                res.on('end', () => {
                    reject(new Error(`HTTP ${res.statusCode}: ${errData}`));
                });
                return;
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e: any) {
                    reject(new Error(`JSON Parse Error: ${e.message}. Data: ${data.substring(0, 100)}`));
                }
            });
            res.on('error', err => reject(err));
        });

        req.on('error', err => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error("Timeout connecting to server"));
        });

        req.write(payload);
        req.end();
    });
}

function parseQuotaData(raw: any): QuotaData[] {
    const configs = raw?.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
    const results: QuotaData[] = [];

    for (const config of configs) {
        if (!config.label) continue;
        
        let percent = 0;
        let refreshTime = 'Exhausted';

        if (config.quotaInfo) {
            const fraction = config.quotaInfo.remainingFraction;
            if (typeof fraction === 'number') {
                percent = Math.max(0, Math.min(1, fraction)) * 100;
            }
            if (config.quotaInfo.resetTime) {
                refreshTime = getRelativeTime(config.quotaInfo.resetTime);
            }
        }

        results.push({
            model: config.label,
            percent: Math.round(percent),
            refreshTime
        });
    }

    return results.sort((a, b) => a.percent - b.percent);
}

function getRelativeTime(isoDate: string): string {
    const future = new Date(isoDate).getTime();
    const now = Date.now();
    const diffMs = future - now;
    
    if (diffMs <= 0) return 'Ready';
    
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 60) return `${minutes} minutes`;
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours < 24) return `${hours} hr, ${remainingMinutes} min`;
    
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days} day${days > 1 ? 's' : ''}, ${remainingHours} hr`;
}
