import * as http from 'http';

export function queryServer(port: number, token: string): Promise<any> {
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
