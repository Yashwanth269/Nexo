'use strict';

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

class S3Service {
    constructor() {
        this.bucketName = process.env.AWS_S3_BUCKET || 'nexo-media';
        this.region = process.env.AWS_REGION || 'us-east-1';
        
        // Only initialize client if credentials are provided
        if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
            this.client = new S3Client({
                region: this.region,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
                }
            });
            this.isEnabled = true;
            console.log('✅ [S3] AWS S3 Service initialized successfully.');
        } else {
            console.log('⚠️ [S3] AWS Credentials missing in .env. Falling back to local upload storage.');
            this.isEnabled = false;
        }
    }

    /**
     * Uploads a local file to S3
     * @param {string} filePath - Absolute path to local file
     * @param {string} originalName - Original filename
     * @param {string} mimeType - File mimetype
     * @returns {Promise<string>} - Public S3 URL or local path fallback
     */
    async uploadFile(filePath, originalName, mimeType) {
        if (!this.isEnabled) {
            // Local fallback path
            return `/uploads/${path.basename(filePath)}`;
        }

        const fileStream = fs.createReadStream(filePath);
        const uniqueKey = `${Date.now()}-${Math.round(Math.random() * 1E9)}-${originalName.replace(/\s+/g, '_')}`;

        const uploadParams = {
            Bucket: this.bucketName,
            Key: uniqueKey,
            Body: fileStream,
            ContentType: mimeType,
        };

        try {
            await this.client.send(new PutObjectCommand(uploadParams));
            return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${uniqueKey}`;
        } catch (error) {
            console.error('❌ [S3] Upload failed, falling back to local file path:', error);
            return `/uploads/${path.basename(filePath)}`;
        }
    }
}

module.exports = new S3Service();
