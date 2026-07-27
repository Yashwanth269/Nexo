'use strict';

class ImageValidatorService {
    /**
     * Runs automated quality validation checks on generated image buffer
     */
    static validateImageBuffer(imageBuffer) {
        if (!Buffer.isBuffer(imageBuffer)) {
            return { isValid: false, reason: 'Invalid payload: expected Buffer.' };
        }

        // 1. Minimum File Size Check (> 200 Bytes)
        if (imageBuffer.length < 200) {
            return { isValid: false, reason: `Image file too small (${imageBuffer.length} bytes, minimum 200 bytes required).` };
        }

        // 2. Maximum File Size Check (< 10MB)
        if (imageBuffer.length > 10 * 1024 * 1024) {
            return { isValid: false, reason: `Image file too large (${(imageBuffer.length / (1024 * 1024)).toFixed(2)} MB).` };
        }

        // 3. Header Magic Byte Check (PNG, JPEG, WebP)
        const isPng = imageBuffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
        const isJpeg = imageBuffer.slice(0, 3).equals(Buffer.from([0xFF, 0xD8, 0xFF]));
        const isWebp = imageBuffer.slice(0, 4).equals(Buffer.from('RIFF')) && imageBuffer.slice(8, 12).equals(Buffer.from('WEBP'));

        if (!isPng && !isJpeg && !isWebp) {
            return { isValid: false, reason: 'Unrecognized image header magic bytes (must be PNG, JPEG, or WebP).' };
        }

        const format = isPng ? 'PNG' : (isJpeg ? 'JPEG' : 'WEBP');

        return {
            isValid: true,
            format,
            sizeBytes: imageBuffer.length,
            reason: 'Passed automated quality validation.'
        };
    }
}

module.exports = ImageValidatorService;
