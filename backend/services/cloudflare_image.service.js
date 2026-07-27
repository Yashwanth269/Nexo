'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class CloudflareImageService {
    constructor() {
        this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
        this.apiToken = process.env.CLOUDFLARE_API_TOKEN || '';
        this.workerUrl = process.env.CLOUDFLARE_WORKER_URL || '';
        this.model = process.env.CLOUDFLARE_AI_MODEL || '@cf/black-forest-labs/flux-1-schnell';

        this.outputDir = path.join(__dirname, '../public/assets/generated');
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    /**
     * Generates image via Cloudflare Workers AI API
     */
    async generateImage({ masterPrompt, negativePrompt, subcategorySlug }) {
        if (!masterPrompt) throw new Error('masterPrompt is required for Cloudflare Workers AI image generation.');

        const fullPrompt = `${masterPrompt}\n\nNegative Prompt: ${negativePrompt || ''}`;
        const fileName = `${subcategorySlug || 'asset'}_${Date.now()}.png`;
        const filePath = path.join(this.outputDir, fileName);
        const relativeUrl = `/assets/generated/${fileName}`;

        try {
            const imageBuffer = await this._callCloudflareApi(fullPrompt);

            // Save generated binary buffer to disk
            await fs.promises.writeFile(filePath, imageBuffer);

            console.log(`✨ [CLOUDFLARE_LIVE_SUCCESS] Received live AI photo from Cloudflare Workers AI (${imageBuffer.length} bytes) -> ${relativeUrl}`);

            return {
                success: true,
                imageBuffer,
                imageUrl: relativeUrl,
                localPath: filePath,
                provider: 'CLOUDFLARE_WORKERS_AI',
                fallbackUsed: false
            };
        } catch (error) {
            console.warn(`⚠️ [CLOUDFLARE_API_WARN] Cloudflare Workers AI call failed (${error.message}). Creating zero-downtime fallback buffer.`);

            const fallbackBuffer = this._createFallbackPngBuffer(subcategorySlug || 'service');
            await fs.promises.writeFile(filePath, fallbackBuffer);

            return {
                success: true,
                imageBuffer: fallbackBuffer,
                imageUrl: relativeUrl,
                localPath: filePath,
                provider: 'NEXO_FALLBACK_ENGINE',
                fallbackUsed: true,
                error: error.message
            };
        }
    }

    /**
     * Internal call to Cloudflare Workers AI API
     */
    _callCloudflareApi(promptText) {
        return new Promise((resolve, reject) => {
            let requestUrl;
            let headers = { 'Content-Type': 'application/json' };

            if (this.workerUrl) {
                // Custom Cloudflare Worker URL
                requestUrl = new URL(this.workerUrl);
            } else if (this.accountId && this.apiToken) {
                // Direct Cloudflare Workers AI REST API
                requestUrl = new URL(`https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${this.model}`);
                headers['Authorization'] = `Bearer ${this.apiToken}`;
            } else {
                return reject(new Error('Cloudflare Workers AI credentials missing (CLOUDFLARE_ACCOUNT_ID & CLOUDFLARE_API_TOKEN or CLOUDFLARE_WORKER_URL required).'));
            }

            const postData = JSON.stringify({ prompt: promptText });
            headers['Content-Length'] = Buffer.byteLength(postData);

            const options = {
                hostname: requestUrl.hostname,
                port: requestUrl.port || 443,
                path: requestUrl.pathname + requestUrl.search,
                method: 'POST',
                headers,
                timeout: 45000
            };

            const req = https.request(options, (res) => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const bodyBuffer = Buffer.concat(chunks);

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        const contentType = res.headers['content-type'] || '';
                        
                        // If direct binary image returned
                        if (contentType.includes('image/') || contentType.includes('octet-stream')) {
                            return resolve(bodyBuffer);
                        }

                        // If JSON response with base64 image
                        try {
                            const json = JSON.parse(bodyBuffer.toString('utf-8'));
                            if (json.result && json.result.image) {
                                return resolve(Buffer.from(json.result.image, 'base64'));
                            }
                            if (json.image) {
                                return resolve(Buffer.from(json.image, 'base64'));
                            }
                        } catch (e) {
                            // If not JSON but returned bytes > 200
                            if (bodyBuffer.length > 200) {
                                return resolve(bodyBuffer);
                            }
                        }
                    }

                    reject(new Error(`Cloudflare API HTTP ${res.statusCode}: ${bodyBuffer.toString('utf-8').slice(0, 150)}`));
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Cloudflare Workers AI API request timed out after 45 seconds.'));
            });

            req.write(postData);
            req.end();
        });
    }

    /**
     * Fallback PNG Buffer Generator
     */
    _createFallbackPngBuffer(title) {
        const zlib = require('zlib');
        const width = 256;
        const height = 256;
        const lineSize = 1 + width * 4;
        const rawData = Buffer.alloc(height * lineSize);

        for (let y = 0; y < height; y++) {
            const offset = y * lineSize;
            rawData[offset] = 0;
            for (let x = 0; x < width; x++) {
                const pxOffset = offset + 1 + x * 4;
                rawData[pxOffset] = 249;     // R
                rawData[pxOffset + 1] = 115; // G
                rawData[pxOffset + 2] = 22;  // B
                rawData[pxOffset + 3] = 255; // Alpha
            }
        }

        const compressedData = zlib.deflateSync(rawData);

        function makeChunk(type, data) {
            const length = Buffer.alloc(4);
            length.writeUInt32BE(data.length, 0);
            const typeBuffer = Buffer.from(type, 'ascii');
            const payload = Buffer.concat([typeBuffer, data]);

            let c = 0xFFFFFFFF;
            for (let i = 0; i < payload.length; i++) {
                c ^= payload[i];
                for (let j = 0; j < 8; j++) {
                    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                }
            }
            const crcVal = (c ^ 0xFFFFFFFF) >>> 0;
            const crc = Buffer.alloc(4);
            crc.writeUInt32BE(crcVal, 0);
            return Buffer.concat([length, payload, crc]);
        }

        const ihdrData = Buffer.alloc(13);
        ihdrData.writeUInt32BE(width, 0);
        ihdrData.writeUInt32BE(height, 4);
        ihdrData[8] = 8;
        ihdrData[9] = 6;
        ihdrData[10] = 0;
        ihdrData[11] = 0;
        ihdrData[12] = 0;

        const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        const ihdrChunk = makeChunk('IHDR', ihdrData);
        const idatChunk = makeChunk('IDAT', compressedData);
        const iendChunk = makeChunk('IEND', Buffer.alloc(0));

        return Buffer.concat([pngHeader, ihdrChunk, idatChunk, iendChunk]);
    }
}

module.exports = new CloudflareImageService();
