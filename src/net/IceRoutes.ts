import type { DataConnection } from 'peerjs';

/** Print the routes each side offered, so a failed join can be diagnosed from the console. */
export async function logRoutes(connection: DataConnection | null): Promise<void> {
  const pc = connection?.peerConnection as RTCPeerConnection | null | undefined;
  if (!pc) return;
  try {
    const stats = await pc.getStats();
    const routes: string[] = [];
    stats.forEach((report: RTCStats & Record<string, unknown>) => {
      if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
        routes.push(`${report.type} ${String(report.candidateType)} ${String(report.address ?? '?')}:${String(report.port)} ${String(report.protocol)}`);
      }
    });
    console.warn(`[net] could not connect to the host (ice ${pc.iceConnectionState}). Routes:\n${routes.join('\n') || '(none)'}`);
  } catch {
    // The connection is already gone.
  }
}
