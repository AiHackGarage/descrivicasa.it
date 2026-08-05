const pool = require('../db/pool');
const { PLAN_LIMITS } = require('../config');

async function checkGenerationLimit(userId, plan) {
  const [rows] = await pool.query(
    'SELECT monthly_generations, monthly_reset FROM users WHERE id = ?',
    [userId]
  );
  if (rows.length === 0) return { allowed: false, remaining: 0 };

  const { monthly_generations, monthly_reset } = rows[0];
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const resetMonth = monthly_reset ? monthly_reset.slice(0, 7) : null;
  const limit = PLAN_LIMITS[plan] || 3;

  if (resetMonth !== thisMonth) {
    await pool.query(
      'UPDATE users SET monthly_generations = 0, monthly_reset = ? WHERE id = ?',
      [today, userId]
    );
    return { allowed: true, remaining: limit };
  }

  const remaining = Math.max(0, limit - monthly_generations);
  return { allowed: remaining > 0, remaining };
}

module.exports = { checkGenerationLimit };
