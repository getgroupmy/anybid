import { serverClient } from '@/lib/session';
import { Panel } from '@/components/ConsoleShell';
import { CampaignForm } from '@/components/CampaignForm';

export const metadata = { title: 'New campaign' };
export const dynamic = 'force-dynamic';

export default async function NewCampaignPage() {
  const api = await serverClient();
  const { categories } = await api.categories.tree();

  return (
    <Panel title="Create a campaign">
      <CampaignForm categories={categories} />
    </Panel>
  );
}
