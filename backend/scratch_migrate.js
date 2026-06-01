const { poolPromise } = require("./config/db");
const { initDB } = require("./config/init");

async function migrate() {
  try {
    console.log("Connecting to database...");
    const pool = await poolPromise;
    if (pool) {
      console.log("Database connected. Running initDB...");
      await initDB(pool);
      console.log("Migration completed successfully!");
    } else {
      console.log("Failed to get pool.");
    }
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    process.exit(0);
  }
}

migrate();
