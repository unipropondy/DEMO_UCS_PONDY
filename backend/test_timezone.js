const { getBusinessDatePrefix, getBusinessDaySqlBounds } = require('./utils/timezoneHelper');

function runTest() {
    const tz = 'Asia/Singapore';
    const offset = 180; // 3 AM rollover
    
    console.log(`=== Testing Timezone Logic ===`);
    console.log(`Business Timezone: ${tz}`);
    console.log(`DayEndOffset: ${offset} mins (3 AM)`);
    console.log(`------------------------------------------`);

    const testTimes = [
        "2026-06-04T23:59:00Z",
        "2026-06-05T00:00:00Z",
        "2026-06-05T00:30:00Z",
        "2026-06-05T02:59:00Z",
        "2026-06-05T03:00:00Z",
        "2026-06-05T03:01:00Z",
    ];

    // For tests, we assume the test strings are absolute UTC times representing those times in Singapore.
    // Wait, let's just create absolute UTC times that correspond exactly to those Singapore local times.
    // SG is UTC+8. So "2026-06-04T23:59:00 in SG" = "2026-06-04T15:59:00Z"
    const testLocalTimes = [
        "2026-06-04T23:59:00",
        "2026-06-05T00:00:00",
        "2026-06-05T00:30:00",
        "2026-06-05T02:59:00",
        "2026-06-05T03:00:00",
        "2026-06-05T03:01:00",
    ];

    for (const localStr of testLocalTimes) {
        // Convert local time string to absolute UTC assuming Asia/Singapore
        const { fromZonedTime } = require('date-fns-tz');
        const utcDate = fromZonedTime(localStr, tz);
        
        const prefix = getBusinessDatePrefix(utcDate, tz, offset);
        console.log(`Order at ${localStr} local -> Assigned Prefix: ${prefix}`);
    }

    console.log(`------------------------------------------`);
    console.log(`SQL Bounds for target date '2026-06-04' with 3 AM offset:`);
    const bounds = getBusinessDaySqlBounds('daily', '2026-06-04', tz, offset);
    console.log(`Start Bound SQL (in DB Local SG Time): ${bounds.startSqlStr}`);
    console.log(`End Bound SQL   (in DB Local SG Time): ${bounds.endSqlStr}`);
    
    console.log(`------------------------------------------`);
    console.log(`SQL Bounds for target date '2026-06-04' with 0 AM offset (Midnight):`);
    const boundsMid = getBusinessDaySqlBounds('daily', '2026-06-04', tz, 0);
    console.log(`Start Bound SQL (in DB Local SG Time): ${boundsMid.startSqlStr}`);
    console.log(`End Bound SQL   (in DB Local SG Time): ${boundsMid.endSqlStr}`);
}

runTest();
