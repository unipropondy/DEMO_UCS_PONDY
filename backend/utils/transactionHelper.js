const { sql, getPool } = require("../config/db");

// Keep a registry of active transactions for monitoring and emergency rollback
const activeTransactions = new Set();

/**
 * Execute business logic inside an SQL transaction with automated lifecycle management.
 *
 * @param {Function} callback - Async function executing operations, receives the (transaction) object.
 * @param {Object} options - Configuration options.
 * @param {string} options.name - Name of transaction for diagnostics and logging.
 * @param {number} options.timeoutMs - Timeout threshold in milliseconds (default: 15000).
 */
async function runInTransaction(callback, options = {}) {
  const name = options.name || "AnonymousTransaction";
  const timeoutMs = options.timeoutMs || 15000;
  const startTime = Date.now();

  const pool = getPool();
  if (!pool) {
    throw new Error(`[TX] [${name}] Database connection pool is not initialized or connected.`);
  }

  const transaction = new sql.Transaction(pool);
  let isDone = false;

  const registryItem = {
    tx: transaction,
    name,
    startTime,
    rollback: async () => {
      if (isDone) return;
      try {
        console.warn(`[TX] [${name}] Emergency rollback initiated via registry.`);
        await transaction.rollback();
        console.warn(`[TX] [${name}] Emergency rollback completed.`);
      } catch (err) {
        console.error(`[TX] [${name}] Emergency rollback failed: ${err.message}`);
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
        console.log(`[TX] [${name}] Rolling back transaction...`);
        await transaction.rollback();
        console.log(`[TX] [${name}] Rollback completed successfully.`);
      } catch (rollbackErr) {
        console.error(`[TX] [${name}] Rollback failed: ${rollbackErr.message}`);
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
