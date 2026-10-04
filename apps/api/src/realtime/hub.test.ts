/**
 * What a socket is allowed to hold, and what it must let go of.
 *
 * Both of these are about state that outlives the moment it was granted: a
 * private channel granted to one identity and kept after the socket changed
 * identity, and channel membership granted per message with nothing limiting
 * how many messages arrive. Neither needs a database.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listingChannel, userChannel, type ServerMessage } from '@anybid/shared';
import { RealtimeHub } from './hub.ts';

/** A socket that only records what the hub sends it. */
function fakeSocket() {
  const frames: ServerMessage[] = [];
  return {
    frames,
    socket: {
      readyState: 1,
      OPEN: 1,
      send: (raw: string) => frames.push(JSON.parse(raw) as ServerMessage),
      ping: () => undefined,
      terminate: () => undefined,
    },
  };
}

const ALICE = 'user-alice';
const BOB = 'user-bob';

function notification(title: string): ServerMessage {
  return { t: 'notification', payload: { id: 'n1', type: 'OUTBID', title, body: '', link: null } };
}

describe('signing in on a socket that was already signed in', () => {
  it('stops delivering the previous account its private notifications', () => {
    const hub = new RealtimeHub();
    const { socket, frames } = fakeSocket();
    const client = hub.add(socket as never, null);

    hub.authenticate(client, ALICE);
    hub.authenticate(client, BOB);

    hub.publish(userChannel(ALICE), notification("Alice's business"));
    hub.publish(userChannel(BOB), notification("Bob's business"));

    const titles = frames.map((f) => (f.t === 'notification' ? f.payload.title : f.t));
    assert.ok(
      !titles.includes("Alice's business"),
      `a socket signed in as Bob received Alice's private notification: ${titles.join(', ')}`,
    );
    assert.ok(titles.includes("Bob's business"), 'and Bob must still get his own');
  });

  it('keeps the public channels it was watching', () => {
    const hub = new RealtimeHub();
    const { socket, frames } = fakeSocket();
    const client = hub.add(socket as never, null);

    hub.subscribe(client, [listingChannel('abc')]);
    hub.authenticate(client, ALICE);

    hub.publish(listingChannel('abc'), { t: 'pong', serverTime: 1 });
    assert.equal(
      frames.filter((f) => f.t === 'pong').length,
      1,
      'signing in must not drop the auction the socket was watching',
    );
  });

  it('still refuses another account’s private channel outright', () => {
    const hub = new RealtimeHub();
    const { socket, frames } = fakeSocket();
    const client = hub.add(socket as never, null);
    hub.authenticate(client, BOB);

    const accepted = hub.subscribe(client, [userChannel(ALICE)]);
    hub.publish(userChannel(ALICE), notification("Alice's business"));

    assert.deepEqual(accepted, [], 'asking for another user’s channel accepts nothing');
    assert.equal(
      frames.filter((f) => f.t === 'notification').length,
      0,
      'and nothing published there reaches this socket',
    );
  });

  it('refuses a private channel on a socket that never signed in', () => {
    const hub = new RealtimeHub();
    const { socket } = fakeSocket();
    const client = hub.add(socket as never, null);

    assert.deepEqual(hub.subscribe(client, [userChannel(ALICE)]), []);
    // 'user:' with nothing after it is the shape an unauthenticated client
    // would land on if the guard compared against an empty id by accident.
    assert.deepEqual(hub.subscribe(client, ['user:']), []);
  });
});

describe('a socket that keeps subscribing', () => {
  it('cannot make the server hold channels without limit', () => {
    const hub = new RealtimeHub();
    const { socket } = fakeSocket();
    const client = hub.add(socket as never, null);

    // What one anonymous connection could do before: 200 messages of 50.
    for (let batch = 0; batch < 200; batch += 1) {
      hub.subscribe(
        client,
        Array.from({ length: 50 }, (_, i) => `junk:${batch}:${i}`),
      );
    }

    assert.ok(
      hub.stats.channels <= 200,
      `one socket made the server hold ${hub.stats.channels} channels`,
    );
    assert.ok(
      client.channels.size <= 200,
      `one socket holds ${client.channels.size} channels`,
    );
  });

  it('still accepts what a real page asks for', () => {
    const hub = new RealtimeHub();
    const { socket } = fakeSocket();
    const client = hub.add(socket as never, null);

    // A screen of marketplace cards, which is the largest honest ask.
    const wanted = Array.from({ length: 24 }, (_, i) => listingChannel(`listing-${i}`));
    assert.deepEqual(hub.subscribe(client, wanted), wanted, 'the cap must not bite a real client');
  });

  it('releases every channel when the socket goes away', () => {
    const hub = new RealtimeHub();
    const { socket } = fakeSocket();
    const client = hub.add(socket as never, null);

    hub.subscribe(client, [listingChannel('a'), listingChannel('b')]);
    assert.equal(hub.stats.channels, 2);
    hub.remove(client);
    assert.equal(hub.stats.channels, 0, 'a closed socket must not keep its channels alive');
    assert.equal(hub.stats.clients, 0);
  });
});
