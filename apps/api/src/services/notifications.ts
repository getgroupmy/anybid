import { userChannel } from '@anybid/shared';
import { prisma } from '../db.ts';
import { hub } from '../realtime/hub.ts';

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
}

/** Persists a notification and pushes it to any live socket for that user. */
export async function notify(input: NotifyInput): Promise<void> {
  const row = await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
    },
  });
  hub.publish(userChannel(input.userId), {
    t: 'notification',
    payload: { id: row.id, type: row.type, title: row.title, body: row.body, link: row.link },
  });
}

export async function notifyMany(inputs: NotifyInput[]): Promise<void> {
  await Promise.all(inputs.map((i) => notify(i)));
}
