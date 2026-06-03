const { sql, getPool } = require("../config/db");

// Keep a registry of active transactions for monitoring and emergency rollback
const activeTransactions = new Set();

// 🚀 GHOST SHIELD: Globally intercept sql.Request constructor to track requests created with new sql.Request(transaction)
const originalRequest = sql.Request;
sql.Request = function(connection, ...args) {
  const req = new originalRequest(connection, ...args);
  
  // If connection is a Transaction and has our custom activeRequests registry, track it
  if (connection && connection.activeRequests) {
    connection.activeRequests.add(req);
    
    const originalQuery = req.query;
    req.query = async function(...queryArgs) {
      try {
        return await originalQuery.apply(req, queryArgs);
      } finally {
        connection.activeRequests.delete(req);
      }
    };

    const originalExecute = req.execute;
    req.execute = async function(...execArgs) {
      try {
        return await originalExecute.apply(req, execArgs);
      } finally {
        connection.activeRequests.delete(req);
      }
    };
  }
  return req;
};
// Inherit prototype and static properties
sql.Request.prototype = originalRequest.prototype;
Object.assign(sql.Request, originalRequest);

/**
 * Execute business logic inside an SQL transaction with automated lifecycle management.
 *
 * @param {Function} callback - Async function executing operations, receives the (transaction) object.
 * @param {Object} options - Configuration options.
 * @param {string} options.name - Name of transaction for diagnostics and logging.
 * @param {number} options.timeoutMs - Timeout threshold in milliseconds (default: 30000).
 */
async function runInTransaction(callback, options = {}) {
  const name = options.name || "AnonymousTransaction";
  const timeoutMs = options.timeoutMs || 30000; // Increased default timeout to 30s
  const startTime = Date.now();

  const pool = getPool();
  if (!pool) {
    throw new Error(`[TX] [${name}] Database connection pool is not initialized or connected.`);
  }

  const transaction = new sql.Transaction(pool);
  const activeRequests = new Set();
  transaction.activeRequests = activeRequests;
  let isDone = false;

  // Intercept transaction.request() to track requests created via method
  const originalTxRequest = transaction.request;
  transaction.request = function(...args) {
    const req = originalTxRequest.apply(transaction, args);
    activeRequests.add(req);

    const originalQuery = req.query;
    req.query = async function(...queryArgs) {
      try {
        return await originalQuery.apply(req, queryArgs);
      } finally {
        activeRequests.delete(req);
      }
    };

    const originalExecute = req.execute;
    req.execute = async function(...execArgs) {
      try {
        return await originalExecute.apply(req, execArgs);
      } finally {
        activeRequests.delete(req);
      }
    };

    return req;
  };

  const registryItem = {
    tx: transaction,
    name,
    startTime,
    rollback: async () => {
      if (isDone) return;
      try {
        console.warn(`[TX] [${name}] Emergency rollback initiated via registry.`);
        
        // 1. Cancel all active queries on the connection to prevent "request in progress" error
        if (activeRequests.size > 0) {
          console.warn(`[TX] [${name}] Cancelling ${activeRequests.size} active query requests...`);
          for (const req of activeRequests) {
            try {
              req.cancel();
            } catch (err) {
              console.error(`[TX] [${name}] Failed to cancel active request: ${err.message}`);
            }
          }
          // Poll until activeRequests is empty or we hit a max wait time of 5 seconds
          const cancelStartTime = Date.now();
          while (activeRequests.size > 0 && Date.now() - cancelStartTime < 5000) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          if (activeRequests.size > 0) {
            console.warn(`[TX] [${name}] Warning: ${activeRequests.size} requests could not be cancelled in 5s.`);
          }
        }

        // 2. Rollback
        await transaction.rollback();
        console.warn(`[TX] [${name}] Emergency rollback completed.`);
      } catch (err) {
        console.error(`[TX] [${name}] Emergency rollback failed: ${err.message}`);
        try {
          const conn = transaction._acquiredConnection;
          if (conn) {
            console.warn(`[TX] [${name}] Forcing connection closure to clean up database locks...`);
            if (typeof conn.close === 'function') {
              conn.close();
            } else if (conn.socket && typeof conn.socket.destroy === 'function') {
              conn.socket.destroy();
            }
          }
        } catch (closeErr) {
          console.error(`[TX] [${name}] Failed to force close connection: ${closeErr.message}`);
        }
      } finally {
        isDone = true;
        activeTransactions.delete(registryItem);
      }
    }
  };

  activeTransactions.add(registryItem);

  try {
    console.log(`[TX] [${name}] Beginning transaction...`);
    await transaction.begin();

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Transaction execution timeout exceeded (${timeoutMs}ms)`));
      }, timeoutMs);
    });

    // Execute business logic with timeout race
    const result = await Promise.race([
      callback(transaction),
      timeoutPromise
    ]);

    clearTimeout(timeoutId);

    console.log(`[TX] [${name}] Committing transaction...`);
    await transaction.commit();
    isDone = true;

    const duration = Date.now() - startTime;
    console.log(`[TX] [${name}] Transaction committed successfully in ${duration}ms.`);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[TX] [${name}] Transaction failed after ${duration}ms: ${error.message}`);

    if (!isDone) {
      try {
        // 1. Cancel all active queries on the connection to prevent "request in progress" error
        if (activeRequests.size > 0) {
          console.warn(`[TX] [${name}] Cancelling ${activeRequests.size} active query requests...`);
          for (const req of activeRequests) {
            try {
              req.cancel();
            } catch (err) {
              console.error(`[TX] [${name}] Failed to cancel active request: ${err.message}`);
            }
          }
          // Poll until activeRequests is empty or we hit a max wait time of 5 seconds
          const cancelStartTime = Date.now();
          while (activeRequests.size > 0 && Date.now() - cancelStartTime < 5000) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          if (activeRequests.size > 0) {
            console.warn(`[TX] [${name}] Warning: ${activeRequests.size} requests could not be cancelled in 5s.`);
          }
        }

        console.log(`[TX] [${name}] Rolling back transaction...`);
        await transaction.rollback();
        console.log(`[TX] [${name}] Rollback completed successfully.`);
      } catch (rollbackErr) {
        console.error(`[TX] [${name}] Rollback failed: ${rollbackErr.message}`);
        try {
          const conn = transaction._acquiredConnection;
          if (conn) {
            console.warn(`[TX] [${name}] Forcing connection closure to clean up database locks...`);
            if (typeof conn.close === 'function') {
              conn.close();
            } else if (conn.socket && typeof conn.socket.destroy === 'function') {
              conn.socket.destroy();
            }
          }
        } catch (closeErr) {
          console.error(`[TX] [${name}] Failed to force close connection: ${closeErr.message}`);
        }
      }
    }
    throw error;
  } finally {
    isDone = true;
    activeTransactions.delete(registryItem);
  }
}

/**
 * Rollback all active transactions registered in memory.
 * Typically invoked during process shutdown or global unhandled rejection/exceptions.
 */
async function rollbackAllActive() {
  if (activeTransactions.size === 0) {
    return;
  }
  console.warn(`⚠️ [TX] Process exiting or error occurred. Clearing ${activeTransactions.size} active transactions...`);
  const rollbacks = Array.from(activeTransactions).map(item => item.rollback());
  await Promise.allSettled(rollbacks);
  console.log(`[TX] Emergency rollback process completed.`);
}

module.exports = {
  runInTransaction,
  rollbackAllActive,
  activeTransactions
};
