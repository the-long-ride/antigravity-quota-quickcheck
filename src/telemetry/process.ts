import { exec } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';

const execAsync = promisify(exec);

export async function locateAntigravityBeacon(): Promise<{ pid: number; token: string } | null> {
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

    const tokenPattern = /--csrf[_-]?token[=\s]+([a-f0-9-]+)/i;
    const extractToken = (text: string): string | null => {
        const match = text.match(tokenPattern);
        return match ? match[1] : null;
    };

    if (os === 'win32') {
        try {
            const trimmedOutput = output.trim();
            if (!trimmedOutput) return null;
            const data = JSON.parse(trimmedOutput);
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

export async function detectActivePort(pid: number): Promise<number | null> {
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
            // Using -H to suppress headers and -n for numeric addresses
            // We search for the pid in the entire line and then extract the port
            const { stdout } = await execAsync(
                `ss -tlnpH 2>/dev/null | grep -F "pid=${pid},"`,
                { timeout: 5000 }
            );
            output = stdout;
        }
    } catch {
        return null;
    }

    const ports: number[] = [];
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Match port: either just digits (Windows/macOS) or :PORT (Linux)
        // We look for digits that are either at the start of the line or preceded by a colon,
        // and followed by either whitespace or the end of the line.
        const match = trimmed.match(/(?:^|:)(\d+)(?:\s|$)/);
        if (match) {
            ports.push(parseInt(match[1], 10));
        }
    }

    return ports.length > 0 ? ports[0] : null;
}

