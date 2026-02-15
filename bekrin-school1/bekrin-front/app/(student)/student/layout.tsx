import { Layout } from "@/components/Layout";
import { RoleGuard } from "@/components/RoleGuard";

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleGuard requiredRole="student">
      <Layout>{children}</Layout>
    </RoleGuard>
  );
}
