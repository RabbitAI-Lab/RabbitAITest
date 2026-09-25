import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { TopBar } from '@/components/TopBar';
import { LeftNav } from '@/components/LeftNav';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.userId) redirect('/login');
  return (
    <div className="min-h-screen">
      <TopBar email={session.email} />
      <div className="flex" style={{ minHeight: 'calc(100vh - 48px)' }}>
        <LeftNav />
        <main className="flex-1 p-6 min-w-0">{children}</main>
      </div>
    </div>
  );
}
