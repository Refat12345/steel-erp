import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canOpenMillLiveDashboard } from "@/lib/mill-live-access";

export default async function MillLiveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (
    !session?.user?.username ||
    !canOpenMillLiveDashboard({
      username: session.user.username,
      permissions: session.user.permissions,
    })
  ) {
    redirect("/forbidden");
  }

  return <>{children}</>;
}
