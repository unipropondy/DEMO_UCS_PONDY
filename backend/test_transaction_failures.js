const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const { sql, poolPromise, getPool } = require("./config/db");
const { runInTransaction, activeTransactions, rollbackAllActive } = require("./utils/transactionHelper");

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log("🚦 [Test] Initializing test suite...");
  
  // Wait for pool connection
  const pool = await poolPromise;
  if (!pool || !pool.connected) {
    console.error("❌ [Test] Database not connected. Aborting tests.");
    process.exit(1);
  }
  console.log("✅ [Test] Database pool connected. Starting test cases...\n");

  let passed = 0;
  let failed = 0;

  // Test Case 1: Exception Rollback
  try {
    console.log("🔹 [Test 1] Testing Exception Rollback...");
    console.log("Registry size before:", activeTransactions.size);
    
    await runInTransaction(async (transaction) => {
      console.log("Inside transaction. Registry size:", activeTransactions.size);
      
      // Run dummy query
      await transaction.request().query("SELECT 1 as val");
      
      console.log("Throwing intentional error...");
      throw new Error("Intentional exception inside transaction callback");
    }, { name: "TestExceptionRollback" });
    
    console.error("❌ Test 1 Failed: Transaction did not throw.");
    failed++;
  } catch (err) {
    if (err.message.includes("Intentional exception")) {
      console.log("✅ Test 1 Passed: Exception caught correctly.");
      console.log("Registry size after:", activeTransactions.size);
      if (activeTransactions.size === 0) {
        console.log("✅ Registry successfully cleared.");
        passed++;
      } else {
        console.error("❌ Registry not cleared!");
        failed++;
      }
    } else {
      console.error("❌ Test 1 Failed with unexpected error:", err.message);
      failed++;
    }
  }
  console.log("\n--------------------------------------------------\n");

  // Test Case 2: Timeout Racing and Auto Rollback
  try {
    console.log("🔹 [Test 2] Testing Transaction Timeout...");
    console.log("Registry size before:", activeTransactions.size);

    await runInTransaction(async (transaction) => {
      console.log("Inside transaction. Registry size:", activeTransactions.size);
      
      await transaction.request().query("SELECT 1 as val");
      
      console.log("Sleeping for 3 seconds (exceeding 1s timeout option)...");
      await sleep(3000);
      
      console.log("This should not execute!");
    }, { name: "TestTimeoutRollback", timeoutMs: 1000 });

    console.error("❌ Test 2 Failed: Transaction did not timeout.");
    failed++;
  } catch (err) {
    if (err.message.includes("timeout exceeded")) {
      console.log("✅ Test 2 Passed: Timeout caught correctly:", err.message);
      console.log("Registry size after:", activeTransactions.size);
      if (activeTransactions.size === 0) {
        console.log("✅ Registry successfully cleared.");
        passed++;
      } else {
        console.error("❌ Registry not cleared!");
        failed++;
      }
    } else {
      console.error("❌ Test 2 Failed with unexpected error:", err.message);
      failed++;
    }
  }
  console.log("\n--------------------------------------------------\n");

  // Test Case 3: Emergency Global Cleanup
  try {
    console.log("🔹 [Test 3] Testing Global Emergency Cleanup (rollbackAllActive)...");
    console.log("Registry size before:", activeTransactions.size);

    // Start transaction but don't await its completion to keep it active
    const txPromise = runInTransaction(async (transaction) => {
      await transaction.request().query("SELECT 1 as val");
      console.log("Transaction started. Sleeping to stay active...");
      await sleep(5000);
      console.log("Finished sleep (should not be reached if rolled back).");
    }, { name: "TestGlobalCleanup" });

    // Wait a brief moment to let transaction begin
    await sleep(500);

    console.log("Registry size during active state:", activeTransactions.size);
    if (activeTransactions.size !== 1) {
      throw new Error("Active transaction not registered!");
    }

    console.log("Executing emergency rollbackAllActive()...");
    await rollbackAllActive();

    console.log("Registry size after rollbackAllActive():", activeTransactions.size);
    
    // The transaction promise should reject due to rollback
    try {
      await txPromise;
    } catch (e) {
      console.log("Transaction promise rejected as expected:", e.message);
    }

    if (activeTransactions.size === 0) {
      console.log("✅ Test 3 Passed: Emergency rollback successfully cleared all transactions.");
      passed++;
    } else {
      console.error("❌ Registry not cleared after emergency cleanup!");
      failed++;
    }
  } catch (err) {
    console.error("❌ Test 3 Failed:", err.message);
    failed++;
  }
  console.log("\n--------------------------------------------------\n");

  console.log(`📊 Test Results: ${passed} Passed, ${failed} Failed.`);
  if (failed > 0) {
    console.error("❌ One or more tests failed!");
    process.exit(1);
  } else {
    console.log("🎉 All tests passed successfully!");
    process.exit(0);
  }
}

runTests();
