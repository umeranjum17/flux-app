import { EventEmitter } from 'events';
import type { RemoteEventChannel } from './protocol';
import { isRemoteEventChannel } from './protocol';

type RemoteEventListener = (payload: unknown) => void;

export class RemoteEventBus {
  private readonly emitter = new EventEmitter();

  publish(channel: string, payload: unknown): void {
    if (!isRemoteEventChannel(channel)) return;
    this.emitter.emit(channel, payload);
  }

  subscribe(channel: RemoteEventChannel, listener: RemoteEventListener): () => void {
    this.emitter.on(channel, listener);
    return () => this.emitter.off(channel, listener);
  }
}
