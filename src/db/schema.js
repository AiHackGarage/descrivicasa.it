const pool = require('./pool');
const logger = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

async function initDatabase() {
  try {
    const conn = await pool.getConnection();

    // Users table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) DEFAULT NULL,
        google_id VARCHAR(255) DEFAULT NULL UNIQUE,
        avatar VARCHAR(500) DEFAULT NULL,
        plan ENUM('free','base','pro') DEFAULT 'free',
        monthly_generations INT DEFAULT 0,
        monthly_reset DATE DEFAULT NULL,
        marketing_consent BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Add columns if missing (for existing tables)
    try { await conn.query('ALTER TABLE users ADD COLUMN monthly_generations INT DEFAULT 0 AFTER plan'); } catch (_) {}
    try { await conn.query('ALTER TABLE users ADD COLUMN monthly_reset DATE DEFAULT NULL AFTER monthly_generations'); } catch (_) {}
    try { await conn.query('ALTER TABLE users ADD COLUMN marketing_consent BOOLEAN DEFAULT FALSE AFTER monthly_reset'); } catch (_) {}
    try { await conn.query('ALTER TABLE users ADD COLUMN stripe_customer_id VARCHAR(255) DEFAULT NULL AFTER marketing_consent'); } catch (_) {}
    try { await conn.query('ALTER TABLE users ADD COLUMN stripe_subscription_id VARCHAR(255) DEFAULT NULL AFTER stripe_customer_id'); } catch (_) {}
    try { await conn.query('ALTER TABLE users ADD COLUMN subscription_status VARCHAR(50) DEFAULT NULL AFTER stripe_subscription_id'); } catch (_) {}

    // Generations history table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS generations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        description TEXT NOT NULL,
        image_urls TEXT DEFAULT NULL,
        model VARCHAR(100) DEFAULT NULL,
        property_uuid VARCHAR(36) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    try { await conn.query('ALTER TABLE generations ADD COLUMN property_uuid VARCHAR(36) DEFAULT NULL AFTER model'); } catch (_) {}

    // Properties table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS properties (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        uuid VARCHAR(36) NOT NULL UNIQUE,
        contract_type ENUM('sell','rent') NOT NULL DEFAULT 'sell',
        property_type VARCHAR(50) NOT NULL DEFAULT 'apartment',
        address VARCHAR(300) DEFAULT NULL,
        civic VARCHAR(20) DEFAULT NULL,
        interno VARCHAR(20) DEFAULT NULL,
        cap VARCHAR(10) DEFAULT NULL,
        city VARCHAR(100) DEFAULT NULL,
        province VARCHAR(50) DEFAULT NULL,
        zone VARCHAR(200) DEFAULT NULL,
        latitude DECIMAL(10,7) DEFAULT NULL,
        longitude DECIMAL(10,7) DEFAULT NULL,
        surface INT DEFAULT NULL,
        rooms INT DEFAULT NULL,
        bedrooms INT DEFAULT NULL,
        bathrooms INT DEFAULT NULL,
        floor INT DEFAULT NULL,
        total_floors INT DEFAULT NULL,
        elevator BOOLEAN DEFAULT FALSE,
        building_state VARCHAR(50) DEFAULT NULL,
        year_built INT DEFAULT NULL,
        energy_class VARCHAR(5) DEFAULT NULL,
        energy_index VARCHAR(20) DEFAULT NULL,
        heating VARCHAR(50) DEFAULT NULL,
        air_conditioning BOOLEAN DEFAULT FALSE,
        exposure VARCHAR(100) DEFAULT NULL,
        balcony_sqm INT DEFAULT NULL,
        garden_sqm INT DEFAULT NULL,
        parking BOOLEAN DEFAULT FALSE,
        basement BOOLEAN DEFAULT FALSE,
        furnished VARCHAR(20) DEFAULT 'no',
        price DECIMAL(12,2) DEFAULT NULL,
        condo_fees DECIMAL(8,2) DEFAULT NULL,
        agent_name VARCHAR(200) DEFAULT NULL,
        agent_phone VARCHAR(50) DEFAULT NULL,
        agent_email VARCHAR(255) DEFAULT NULL,
        title VARCHAR(200) DEFAULT NULL,
        description TEXT DEFAULT NULL,
        ai_model VARCHAR(100) DEFAULT NULL,
        photos JSON DEFAULT NULL,
        status ENUM('draft','published','archived') DEFAULT 'draft',
        is_public BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_uuid (uuid),
        INDEX idx_user (user_id),
        INDEX idx_user_status (user_id, status),
        INDEX idx_public (is_public, status)
      )
    `);

    conn.release();
    logger.info('✅ Database tables ready');

    // Run migrations: add agent columns if missing
    try {
      const migrationConn = await pool.getConnection();
      const [cols] = await migrationConn.query("SHOW COLUMNS FROM properties LIKE 'agent_%'");
      if (cols.length === 0) {
        await migrationConn.query('ALTER TABLE properties ADD COLUMN agent_name VARCHAR(200) DEFAULT NULL AFTER condo_fees');
        await migrationConn.query('ALTER TABLE properties ADD COLUMN agent_phone VARCHAR(50) DEFAULT NULL AFTER agent_name');
        await migrationConn.query('ALTER TABLE properties ADD COLUMN agent_email VARCHAR(255) DEFAULT NULL AFTER agent_phone');
        logger.info('✅ Migration: agent columns added');
      }
      migrationConn.release();
    } catch (migErr) {
      logger.error('⚠️  Migration warning:', migErr.message);
    }
  } catch (err) {
    logger.error('❌ Database init error:', err.message);
    logger.info('⚠️  Server will continue without database');
  }
}

module.exports = { initDatabase };
