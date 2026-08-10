import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessMillLiveDashboard } from "@/lib/mill-live-access";

export default async function MillLiveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.username || !canAccessMillLiveDashboard(session.user.username)) {
    redirect("/forbidden");
  }

  return <>{children}</>;
}
