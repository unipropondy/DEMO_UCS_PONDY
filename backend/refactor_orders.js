const fs = require('fs');

const filepath = 'c:/Users/User/Desktop/DEMO_UCS_PONDY/backend/routes/orders.js';
let content = fs.readFileSync(filepath, 'utf-8');

// 1. Add imports at top
if (!content.includes('const { getBusinessTimezoneSettings }')) {
    content = content.replace(
        'const { poolPromise } = require("../config/db");',
        'const { poolPromise } = require("../config/db");\nconst { getBusinessTimezoneSettings } = require("../utils/settingsCache");\nconst { getBusinessDatePrefix } = require("../utils/timezoneHelper");'
    );
}

// 2. Replace the first block (Takeaway)
const block1 = `      const istDate = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
      const todayStr = istDate.toISOString().split("T")[0];
      const datePrefix = todayStr.replace(/-/g, "");`;

const newBlock1 = `      const { timezone, offsetMinutes } = await getBusinessTimezoneSettings();
      const datePrefix = getBusinessDatePrefix(new Date(), timezone, offsetMinutes);
      const todayStr = \`\${datePrefix.substring(0,4)}-\${datePrefix.substring(4,6)}-\${datePrefix.substring(6,8)}\`;`;

content = content.replace(block1, newBlock1);

// 3. Replace the first block catch (Takeaway fallback)
const block2 = `      const istDate = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
      const datePrefix = istDate.toISOString().split("T")[0].replace(/-/g, "");`;

const newBlock2 = `      const { timezone, offsetMinutes } = await getBusinessTimezoneSettings();
      const datePrefix = getBusinessDatePrefix(new Date(), timezone, offsetMinutes);`;

content = content.replace(block2, newBlock2);

// 4. Replace the second block (Dine In)
content = content.replace(block1, newBlock1); // Same block text for Dine In

// 5. Replace the second block catch (Dine In fallback)
content = content.replace(block2, newBlock2); // Same block text for Dine In fallback

// Let's also check for any missed ones (like in generateRandomBillId)
if (content.includes('5.5 * 60 * 60 * 1000')) {
    // Just replace them globally if they look exactly like block2
    content = content.replaceAll(block2, newBlock2);
}

fs.writeFileSync(filepath, content, 'utf-8');
console.log("orders.js refactored successfully.");
