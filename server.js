const { app, initDatabase } = require('./src/app');
const { PORT } = require('./src/config');
const logger = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

app.listen(PORT, '0.0.0.0', async () => {
  logger.info(`🚀 DescriviCasa running on http://0.0.0.0:${PORT}`);
  await initDatabase();
});
