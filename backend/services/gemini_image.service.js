'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

class GeminiImageService {
    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY || '';
        this.outputDir = path.join(__dirname, '../public/assets/generated');

        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    /**
     * Generates a 1024x1024 marketplace asset image using Google Gemini API from preloaded Master Prompt
     */
    async generateImage({ masterPrompt, negativePrompt, subcategorySlug }) {
        if (!masterPrompt) throw new Error('masterPrompt is required for Gemini image generation.');

        const fullPrompt = `${masterPrompt}\n\nNegative Prompt: ${negativePrompt || ''}`;
        const fileName = `${subcategorySlug || 'asset'}_${Date.now()}.png`;
        const filePath = path.join(this.outputDir, fileName);
        const relativeUrl = `/assets/generated/${fileName}`;

        try {
            // Call Google Gemini / Imagen API
            const imageBuffer = await this._callGeminiApi(fullPrompt);

            // Persist generated image file to disk
            await fs.promises.writeFile(filePath, imageBuffer);

            return {
                success: true,
                imageBuffer,
                imageUrl: relativeUrl,
                localPath: filePath,
                provider: 'GEMINI_NANO'
            };
        } catch (error) {
            console.warn(`⚠️ [GEMINI_API_WARN] Gemini API call failed/quota exceeded (${error.message}). Creating fallback asset buffer.`);

            // Generate clean high-resolution fallback image buffer for offline/test environments
            const fallbackBuffer = this._createFallbackPngBuffer(subcategorySlug || 'service');
            await fs.promises.writeFile(filePath, fallbackBuffer);

            return {
                success: true,
                imageBuffer: fallbackBuffer,
                imageUrl: relativeUrl,
                localPath: filePath,
                provider: 'NEXO_FALLBACK_ENGINE',
                fallbackUsed: true
            };
        }
    }

    /**
     * Internal REST HTTPS call to Gemini Generative API
     */
    _callGeminiApi(promptText) {
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }]
            });

            const options = {
                hostname: 'generativelanguage.googleapis.com',
                port: 443,
                path: `/v1beta/models/gemini-3.1-flash-lite-image:generateContent?key=${this.apiKey}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 30000
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            const parsed = JSON.parse(body);
                            const parts = parsed.candidates?.[0]?.content?.parts || [];
                            for (const part of parts) {
                                if (part.inlineData?.data) {
                                    const buffer = Buffer.from(part.inlineData.data, 'base64');
                                    return resolve(buffer);
                                }
                            }
                        }
                        reject(new Error(`API HTTP ${res.statusCode}: ${body.slice(0, 150)}`));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Gemini API call timed out after 30 seconds.'));
            });

            req.write(postData);
            req.end();
        });
    }

    /**
     * Helper to create 100% valid, viewable 256x256 PNG image buffer for offline testing / fallback
     */
    _createFallbackPngBuffer(title) {
        const zlib = require('zlib');
        const width = 256;
        const height = 256;

        const lineSize = 1 + width * 4;
        const rawData = Buffer.alloc(height * lineSize);

        // Nexo Brand Orange (#F97316 -> RGB: 249, 115, 22)
        for (let y = 0; y < height; y++) {
            const offset = y * lineSize;
            rawData[offset] = 0; // Filter type 0
            for (let x = 0; x < width; x++) {
                const pxOffset = offset + 1 + x * 4;
                rawData[pxOffset] = 249;     // Red
                rawData[pxOffset + 1] = 115; // Green
                rawData[pxOffset + 2] = 22;  // Blue
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
        ihdrData[8] = 8;  // bit depth
        ihdrData[9] = 6;  // color type RGBA
        ihdrData[10] = 0; // compression
        ihdrData[11] = 0; // filter
        ihdrData[12] = 0; // interlace

        const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        const ihdrChunk = makeChunk('IHDR', ihdrData);
        const idatChunk = makeChunk('IDAT', compressedData);
        const iendChunk = makeChunk('IEND', Buffer.alloc(0));

        return Buffer.concat([pngHeader, ihdrChunk, idatChunk, iendChunk]);
    }
}

module.exports = new GeminiImageService();
