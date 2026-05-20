let rawUrl = process.env.EXPO_PUBLIC_API_URL || "https://demoucspondy-production.up.railway.app";
// 🚨 HARDEN: Prevent cached localhost from breaking production builds
if (process.env.NODE_ENV === "production" && rawUrl.includes("localhost")) {
  rawUrl = "https://demoucspondy-production.up.railway.app";
}
export const API_URL = rawUrl;

console.log(`🌐 [Config] API_URL: ${API_URL} | Platform: ${require('react-native').Platform.OS} | Env: ${process.env.NODE_ENV}`);