import { serverClient } from '@/lib/session';
import { Panel } from '@/components/ConsoleShell';
import { SettingsForm } from '@/components/SettingsForm';

export const metadata = { title: 'Settings · Admin' };
export const dynamic = 'force-dynamic';

export default async function AdminSettings() {
  const api = await serverClient();
  const { settings } = await api.admin.settings();

  return (
    <Panel title="Platform settings">
      <SettingsForm settings={settings as Record<string, number | boolean>} />
    </Panel>
  );
}
