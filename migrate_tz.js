const { poolPromise } = require("./backend/config/db");

async function migrate() {
    const pool = await poolPromise;
    try {
        console.log("Migrating CompanySettings schema...");
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('CompanySettings') AND name = 'BusinessTimezone')
            BEGIN
                ALTER TABLE CompanySettings ADD BusinessTimezone NVARCHAR(50) DEFAULT 'Asia/Singapore' NOT NULL;
                ALTER TABLE CompanySettings ADD DayEndOffsetMinutes INT DEFAULT 0 NOT NULL;
                PRINT 'Added columns BusinessTimezone and DayEndOffsetMinutes to CompanySettings.'
            END
            ELSE
            BEGIN
                PRINT 'Columns already exist.'
            END
        `);
        console.log("Migration complete.");
    } catch (e) {
        console.error("Migration failed:", e);
    } finally {
        process.exit(0);
    }
}

migrate();
