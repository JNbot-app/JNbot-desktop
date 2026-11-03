/**
 * Bootstraps a participant that joined an already running session.
 *
 * The state comes from a provider (a JNbot bot or a client running the JNbot
 * mod, mirroring the session): the provider is frozen and both it and the
 * target queue the live stream from the same point, a control-channel barrier
 * proves the provider processed everything before that point, and its capture
 * is written to the target. Configuration, login and session-wide packets are
 * replayed as the raw bytes the server sent; the mod also exports its world as
 * raw packets, a bot's world is compiled. The upstream keeps flowing.
 */
import { states } from 'minecraft-protocol';

import { raceAbort } from './Barrier';
import { ProxyStateCompiler } from './ProxyStateCompiler';
import type { Participant } from './Participant';
import type { Session } from './Session';

export async function bootstrap(
  session: Session,
  target: Participant,
  timeout: AbortSignal,
  /** Leave the provider frozen afterwards, for a switch that commits next. */
  keepSourceFrozen = false,
): Promise<void> {
  const left = new AbortController();
  const onLeave = (reason: string) => left.abort(new Error(reason));
  target.once('leave', onLeave);
  const signal = AbortSignal.any([timeout, left.signal]);
  await session.until(
    () =>
      session.phase === states.PLAY &&
      target.phase !== states.LOGIN &&
      !!session.findProvider(target),
    signal,
    'No bot or JNbot client with a fresh world state is available',
  );
  const source = session.findProvider(target)!;
  source.once('leave', onLeave);
  const log = (stage: string) =>
    global.log?.(`[proxy-sync] ${target.username} ← ${source.username}: ${stage}`);

  source.control.freeze();
  source.hold();
  target.hold();
  try {
    log('barrier');
    await source.control.barrier(signal);
    log('capture');
    const snapshot = await raceAbort(source.provider!.capture(signal), signal, 'State capture timed out');
    if (String(snapshot.protocol) !== String(target.protocol))
      throw new Error('Provider returned a different protocol');
    const { handshake } = snapshot;
    if (!handshake?.login) throw new Error('Provider has no join state');

    if (target.phase === states.CONFIGURATION) {
      log('configuration');
      for (const raw of handshake.configuration) target.writeRaw(raw);
      target.send('finish_configuration', {});
      await target.untilPhase(states.PLAY, signal);
    }
    log('world');
    for (const raw of [handshake.login, handshake.respawn, ...handshake.singletons])
      if (raw) target.writeRaw(raw);
    if (snapshot.bootstrap) {
      for (const raw of snapshot.bootstrap) target.writeRaw(raw);
    } else {
      for (const packet of new ProxyStateCompiler(target.version).compile(snapshot))
        await target.writeDrained(packet.name, packet.data, signal);
    }
    await target.barriers.wait(target, signal);
    target.role = 'spectator';
    log('synced');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    global.log?.(`[proxy-sync] ${target.username} failed: ${message}`, 'warning');
    console.error('[proxy-sync] bootstrap failed:', error);
    target.end(`Could not join the session: ${message}`);
    throw error;
  } finally {
    target.off('leave', onLeave);
    source.off('leave', onLeave);
    source.release();
    target.release();
    if (!keepSourceFrozen && source === session.driver) source.control.resume();
  }
}
