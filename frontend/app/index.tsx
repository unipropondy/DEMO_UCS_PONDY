import { Redirect } from "expo-router";
import { useAuthStore } from "../stores/authStore";

export default function Index() {
  const { user, loginDate, logout } = useAuthStore();

  if (user) {
    const currentDate = new Date().toISOString().split("T")[0];
    if (loginDate && currentDate !== loginDate) {
      logout();
      return <Redirect href="/login" />;
    }

    const userName = (user.userName || "").trim().toUpperCase();
    if (userName === "KDS") {
      return <Redirect href="/(tabs)/kds" />;
    }
    return <Redirect href="/(tabs)/category" />;
  }

  return <Redirect href="/login" />;
}
