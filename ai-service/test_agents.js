const { orchestrateChat } = require('./src/agents/orchestrator');
const { discoverSchema } = require('./src/services/schemaDiscovery.service');

async function runTest() {
  console.log("🚀 Initializing AI Assistant Agentic Pipeline verification...");
  try {
    // 1. Discover Schema
    console.log("\n1. Running Dynamic DB Schema Discovery...");
    const schema = await discoverSchema();
    const tableNames = Object.keys(schema);
    console.log(`✅ Discovered tables: [${tableNames.join(', ')}]`);

    // 2. Run Orchestrator Chat test (Local sandbox mode with fallback logic)
    console.log("\n2. Invoking AI Orchestrator with sales metrics query...");
    const mockSession = "11111111-2222-3333-4444-555555555555";
    const shopId = 1;

    const response = await orchestrateChat("What are my sales today?", mockSession, shopId);
    console.log("\n📊 Orchestrator Chat Response:\n", JSON.stringify(response, null, 2));

    console.log("\n✅ AI Assistant Verification completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Verification Failed:", error);
    process.exit(1);
  }
}

runTest();
