import { TokenDecisionPage } from '@/features/decisions/token-page';

export const metadata = { title: 'Approve request · Travel Approvals' };
export const dynamic = 'force-dynamic';

/**
 * GET here is INERT — it renders a confirmation and mutates nothing. See the
 * note on `peekToken`: mail scanners fetch every link in a message before a
 * human opens it, so a GET that approved would approve everything automatically.
 */
export default async function ApprovePage({ searchParams }: PageProps<'/approve'>) {
  const { token } = await searchParams;
  return (
    <TokenDecisionPage token={typeof token === 'string' ? token : undefined} expected="APPROVE" />
  );
}
