// Mock MySQL pool — in-memory store for tests
const store = {
  users: [],
  properties: [],
  generations: [],
};

function createMockPool() {
  return {
    query(sql, params = []) {
      // Insert users
      if (sql.includes('INSERT INTO users')) {
        const id = store.users.length + 1;
        const user = {
          id,
          name: params[0] || 'Test',
          email: params[1] || 'test@test.it',
          password: params[2] || null,
          plan: 'free',
          monthly_generations: 0,
          monthly_reset: null,
          stripe_customer_id: null,
          stripe_subscription_id: null,
          subscription_status: null,
          avatar: null,
          created_at: new Date().toISOString(),
        };
        store.users.push(user);
        return [{ insertId: id }];
      }

      // Select users
      if (sql.includes('SELECT') && sql.includes('FROM users')) {
        let results = [...store.users];
        if (sql.includes('WHERE id = ?')) {
          results = results.filter(u => u.id === params[0]);
        } else if (sql.includes('WHERE email = ?')) {
          results = results.filter(u => u.email === params[0]);
        }
        return [results];
      }

      // Update users
      if (sql.includes('UPDATE users')) {
        // Simple update
        return [{ affectedRows: 1 }];
      }

      // Insert properties
      if (sql.includes('INSERT INTO properties')) {
        const id = store.properties.length + 1;
        const uuid = params[0];
        store.properties.push({ id, uuid, user_id: params[1], photos: [], status: 'draft' });
        return [{ insertId: id }];
      }

      // Select properties
      if (sql.includes('SELECT') && sql.includes('FROM properties')) {
        return [store.properties];
      }

      // Insert generations
      if (sql.includes('INSERT INTO generations')) {
        return [{ insertId: 1 }];
      }

      // SHOW TABLES etc
      if (sql.includes('SHOW TABLES')) {
        return [[{ Tables_in_test: 'users' }, { Tables_in_test: 'properties' }]];
      }
      if (sql.includes('COUNT(*)')) {
        return [[{ count: store.users.length }]];
      }
      if (sql.includes('SHOW COLUMNS')) {
        return [[{ Field: 'agent_name' }]];
      }

      return [[]];
    },

    getConnection() {
      return {
        query: this.query.bind(this),
        release() {},
      };
    },
  };
}

// Singleton pool
const mockPool = createMockPool();
const mysql = { createPool: () => mockPool };
module.exports = mockPool;

// Also export createPool for the mock
module.exports.createPool = () => mockPool;
