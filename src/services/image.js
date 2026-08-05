const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const logger = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

const IMAGE_MAX_DIM = 1920;
const IMAGE_QUALITY = 80;
const PDF_IMAGE_WIDTH = 800;

async function processUploadedImage(filePath) {
  try {
    const metadata = await sharp(filePath).metadata();
    if (metadata.width <= IMAGE_MAX_DIM && metadata.height <= IMAGE_MAX_DIM
        && metadata.format === 'jpeg') {
      return;
    }
    const tmpPath = filePath + '.tmp';
    await sharp(filePath)
      .resize(IMAGE_MAX_DIM, IMAGE_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: IMAGE_QUALITY, progressive: true })
      .toFile(tmpPath);
    fs.renameSync(tmpPath, filePath);
    logger.info({ path: path.basename(filePath), origSize: metadata.width + 'x' + metadata.height }, '🖼️ Image compressed');
  } catch (err) {
    logger.warn({ err: err.message, file: filePath }, 'Image processing failed, keeping original');
  }
}

async function processUploadedFiles(files) {
  if (!files || files.length === 0) return;
  await Promise.all(files.map(f => processUploadedImage(f.path)));
}

async function resizeForPdf(filePath) {
  try {
    const buffer = await sharp(filePath)
      .resize(PDF_IMAGE_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75, progressive: true })
      .toBuffer();
    return buffer;
  } catch (err) {
    logger.warn({ err: err.message, file: filePath }, 'PDF image resize failed');
    return null;
  }
}

module.exports = { processUploadedImage, processUploadedFiles, resizeForPdf };
