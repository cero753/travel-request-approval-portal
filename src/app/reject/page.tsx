import { TokenDecisionPage } from '@/features/decisions/token-page';

export const metadata = { title: 'Reject request · Travel Approvals' };
export const dynamic = 'force-dynamic';

/** Inert on GET, exactly like /approve — same reasoning, same guarantees. */
export default async function RejectPage({ searchParams }: PageProps<'/reject'>) {
  const { token } = await searchParams;
  return (
    <TokenDecisionPage token={typeof token === 'string' ? token : undefined} expected="REJECT" />
  );
}
