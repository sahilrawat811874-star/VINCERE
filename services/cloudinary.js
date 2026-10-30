/**
 * Swasthya - Cloudinary Secure File & Photo Service
 * 
 * Handles server-side only file uploads for medicine photos and lab reports.
 * Validates MIME types, extensions, magic byte signatures, and file size limits.
 * Exposes NO Cloudinary secrets to the client.
 */

const path = require('path');
const crypto = require('crypto');

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '';
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';

// Allowed configurations
const ALLOWED_MEDICINE = {
  maxBytes: 5 * 1024 * 1024, // 5MB
  mimeTypes: new Set(['image/jpeg', 'image/png', 'image/webp']),
  extensions: new Set(['.jpg', '.jpeg', '.png', '.webp'])
};

const ALLOWED_REPORT = {
  maxBytes: 10 * 1024 * 1024, // 10MB
  mimeTypes: new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  extensions: new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp'])
};

let cloudinarySdk = null;
function getCloudinary() {
  if (cloudinarySdk) return cloudinarySdk;
  if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
    try {
      const c = require('cloudinary').v2;
      c.config({
        cloud_name: CLOUDINARY_CLOUD_NAME,
        api_key: CLOUDINARY_API_KEY,
        api_secret: CLOUDINARY_API_SECRET,
        secure: true
      });
      cloudinarySdk = c;
      return cloudinarySdk;
    } catch (e) {
      console.warn('[Cloudinary] SDK load error:', e.message);
    }
  }
  return null;
}

/**
 * Validates buffer against file header magic bytes to prevent spoofed extensions
 */
function verifyMagicBytes(buffer, mimeType) {
  if (!buffer || buffer.length < 4) return false;

  // PDF: %PDF (% = 0x25, P = 0x50, D = 0x44, F = 0x46)
  if (mimeType === 'application/pdf') {
    return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  }

  // JPEG: FF D8 FF
  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (mimeType === 'image/png') {
    return (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }

  // WebP: 'RIFF' .... 'WEBP'
  if (mimeType === 'image/webp') {
    if (buffer.length < 12) return false;
    const riff = buffer.slice(0, 4).toString('ascii');
    const webp = buffer.slice(8, 12).toString('ascii');
    return riff === 'RIFF' && webp === 'WEBP';
  }

  return false;
}

const CloudinaryService = {
  isConfigured() {
    return Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);
  },

  /**
   * Strictly validates upload request parameters
   */
  validateFile({ buffer, originalname, mimetype, size }, category = 'medicine') {
    const rules = category === 'report' ? ALLOWED_REPORT : ALLOWED_MEDICINE;

    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('No valid file content received.');
    }

    const actualSize = size || buffer.length;
    if (actualSize > rules.maxBytes) {
      const limitMb = rules.maxBytes / (1024 * 1024);
      throw new Error(`File exceeds the maximum allowed size of ${limitMb}MB.`);
    }

    const ext = path.extname(originalname || '').toLowerCase();
    if (!rules.extensions.has(ext)) {
      throw new Error(`Invalid file extension '${ext}'. Allowed: ${Array.from(rules.extensions).join(', ')}`);
    }

    const normMime = (mimetype || '').toLowerCase();
    if (!rules.mimeTypes.has(normMime)) {
      throw new Error(`Invalid MIME type '${normMime}'. Allowed: ${Array.from(rules.mimeTypes).join(', ')}`);
    }

    // Verify binary magic bytes
    if (!verifyMagicBytes(buffer, normMime)) {
      throw new Error(`File contents do not match the expected '${normMime}' signature.`);
    }

    return true;
  },

  /**
   * Upload buffer directly to Cloudinary via SDK or REST
   */
  async upload({ buffer, originalname, mimetype, size }, category = 'medicine') {
    // 1. Validation
    this.validateFile({ buffer, originalname, mimetype, size }, category);

    const folder = category === 'report' ? 'swasthya/reports' : 'swasthya/medicines';
    const resourceType = mimetype === 'application/pdf' ? 'raw' : 'image';
    const c = getCloudinary();

    if (c) {
      return new Promise((resolve, reject) => {
        const stream = c.uploader.upload_stream(
          {
            folder,
            resource_type: resourceType,
            tags: ['swasthya', category],
            use_filename: false,
            unique_filename: true
          },
          (err, result) => {
            if (err) return reject(new Error(`Cloudinary upload failed: ${err.message}`));
            resolve({
              secure_url: result.secure_url,
              public_id: result.public_id,
              format: result.format || path.extname(originalname).replace('.', ''),
              bytes: result.bytes || buffer.length,
              original_filename: originalname,
              created_at: result.created_at || new Date().toISOString()
            });
          }
        );
        stream.end(buffer);
      });
    }

    // Offline / testing fallback: generate unique reference with safe data URI
    const pseudoPublicId = `swasthya_${category}_${crypto.randomBytes(8).toString('hex')}`;
    const base64Data = buffer.toString('base64');
    const dataUrl = `data:${mimetype};base64,${base64Data.slice(0, 500)}...[truncated]`;

    return {
      secure_url: dataUrl,
      public_id: pseudoPublicId,
      format: path.extname(originalname).replace('.', ''),
      bytes: buffer.length,
      original_filename: originalname,
      created_at: new Date().toISOString(),
      offline_fallback: true
    };
  }
};

module.exports = CloudinaryService;

