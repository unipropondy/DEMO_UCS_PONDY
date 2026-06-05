const http = require("http");

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    }).on("error", reject);
  });
}

async function run() {
  const API_URL = "http://localhost:3000";
  
  // Test case 1: Query without range (should return TOP 200)
  try {
    console.log(`Test 1: Fetching default (no range)...`);
    const salesDefault = await fetchUrl(`${API_URL}/api/sales/all`);
    console.log(`Default endpoint returned ${Array.isArray(salesDefault) ? salesDefault.length : "non-array"} items.`);
  } catch (e) {
    console.error("Test 1 error:", e.message);
  }

  // Test case 2: Query monthly range (June 1st to June 30th)
  try {
    console.log(`\nTest 2: Fetching Monthly Range (2026-06-01 to 2026-06-30)...`);
    const salesJune = await fetchUrl(`${API_URL}/api/sales/all?startDate=2026-06-01&endDate=2026-06-30`);
    console.log(`June range returned ${Array.isArray(salesJune) ? salesJune.length : "non-array"} items.`);
    if (Array.isArray(salesJune) && salesJune.length > 0) {
      console.log(`First item:`, salesJune[0]);
      console.log(`Last item:`, salesJune[salesJune.length - 1]);
    }
  } catch (e) {
    console.error("Test 2 error:", e.message);
  }
  
  // Test case 3: Query yearly range (2026-01-01 to 2026-12-31)
  try {
    console.log(`\nTest 3: Fetching Yearly Range (2026-01-01 to 2026-12-31)...`);
    const salesYear = await fetchUrl(`${API_URL}/api/sales/all?startDate=2026-01-01&endDate=2026-12-31`);
    console.log(`Yearly range returned ${Array.isArray(salesYear) ? salesYear.length : "non-array"} items.`);
  } catch (e) {
    console.error("Test 3 error:", e.message);
  }
}

run();
