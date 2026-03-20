import os from 'os';
import { Bonjour } from 'bonjour-service';
import { logDiagnostic } from '../diagnostics/logger';

export class MdnsAdvertiser {
  private bonjour: Bonjour | null = null;
  private service: ReturnType<Bonjour['publish']> | null = null;
  private advertised = false;

  start(port: number, version: string): void {
    this.stop();
    this.bonjour = new Bonjour();
    this.service = this.bonjour.publish({
      name: os.hostname(),
      type: 'flux-ctrl',
      protocol: 'tcp',
      port,
      txt: {
        version,
        hostname: os.hostname(),
      },
    });
    this.service.on('up', () => {
      this.advertised = true;
      logDiagnostic('remote-mdns', 'service advertised', { port, version });
    });
    this.service.on('error', (error) => {
      this.advertised = false;
      logDiagnostic('remote-mdns', 'advertise failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  stop(): void {
    this.advertised = false;
    this.service?.stop?.();
    this.service = null;
    this.bonjour?.destroy();
    this.bonjour = null;
  }

  isAdvertised(): boolean {
    return this.advertised;
  }
}
