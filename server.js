const { app, initDatabase } = require('./src/app');
const { PORT, UPLOAD_DIR } = require('./src/config');
const fs = require('fs');
const path = require('path');
const logger = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

// Auto-cleanup: cancella foto ogni 30 min (più vecchie di 4 ore)
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const FILE_MAX_AGE_MS = 4 * 60 * 60 * 1000;

async function cleanupOldFiles() {
  try {
    const files = await fs.promises.readdir(UPLOAD_DIR);
    const now = Date.now();
    let deleted = 0;
    for (const file of files) {
      const fp = path.join(UPLOAD_DIR, file);
      try {
        const stat = await fs.promises.stat(fp);
        if (now - stat.mtimeMs > FILE_MAX_AGE_MS) {
          await fs.promises.unlink(fp);
          deleted++;
        }
      } catch (_) { /* skip */ }
    }
    if (deleted > 0) logger.info(`🧹 Cleanup: ${deleted} file eliminati`);
  } catch (_) { /* directory doesn't exist */ }
}

app.listen(PORT, '0.0.0.0', async () => {
  logger.info(`🚀 DescriviCasa running on http://0.0.0.0:${PORT}`);
  await initDatabase();
  cleanupOldFiles();
  setInterval(cleanupOldFiles, CLEANUP_INTERVAL_MS);
});
