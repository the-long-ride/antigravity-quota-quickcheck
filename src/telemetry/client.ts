import * as http from 'http';
import * as https from 'https';

export async function queryServer(port: number, token: string): Promise<any> {
    try {
        return await queryServerInternal(port, token, false);
    } catch (e: any) {
        const msg = e.message || '';
        // If we see signs that the server expects HTTPS, retry with it.
        // Go's standard library (often used in language servers) returns "Client sent an HTTP request to an HTTPS server"
        if (
            msg.includes('http instead of https') ||
            msg.includes('HTTPS') ||
            msg.includes('wrong version number') ||
            msg.includes('Client sent an HTTP request to an HTTPS server')
        ) {
            try {
                return await queryServerInternal(port, token, true);
            } catch (innerError) {
                // If HTTPS also fails, throw the original HTTP error as it might be more descriptive
                throw e;
            }
        }
        throw e;
    }
}

function queryServerInternal(port: number, token: string, useHttps: boolean): Promise<any> {
    const client = useHttps ? (https as any) : (http as any);
    
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            metadata: { ideName: 'antigravity' }
        });

        const options: any = {
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
        };

        if (useHttps) {
            // Local language servers usually use self-signed certs
            options.rejectUnauthorized = false;
        }

        const req = client.request(options, (res: any) => {
            if (res.statusCode !== 200) {
                let errData = '';
                res.on('data', (chunk: any) => errData += chunk);
                res.on('end', () => {
                    reject(new Error(`HTTP ${res.statusCode}: ${errData}`));
                });
                return;
            }

            let data = '';
            res.on('data', (chunk: any) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e: any) {
                    reject(new Error(`JSON Parse Error: ${e.message}. Data: ${data.substring(0, 100)}`));
                }
            });
            res.on('error', (err: any) => reject(err));
        });

        req.on('error', (err: any) => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error("Timeout connecting to server"));
        });

        req.write(payload);
        req.end();
    });
}

