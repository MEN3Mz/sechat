// Live statistics for monitoring and debugging (served at /metrics and /stats).

export class Metrics {
  constructor() {
    this.started = Date.now();
    this.totalMessages = 0;
    this.bytesIn = 0;
    this.bytesOut = 0;
    this.connectionsOpened = 0;
    this.connectionsClosed = 0;
    this.active = { ws: 0, sse: 0 }; // open connections per protocol
    this.stamps = []; // times of recent messages
  }

  messageReceived() {
    this.totalMessages++;
    this.stamps.push(Date.now());
  }

  connectionOpened(protocol) {
    this.connectionsOpened++;
    this.active[protocol]++;
  }

  connectionClosed(protocol) {
    this.connectionsClosed++;
    this.active[protocol]--;
  }

  messagesPerSecond(windowSeconds = 10) {
    const cutoff = Date.now() - windowSeconds * 1000;
    while (this.stamps.length && this.stamps[0] < cutoff) this.stamps.shift();
    return Math.round((this.stamps.length / windowSeconds) * 100) / 100;
  }

  snapshot() {
    return {
      uptime_seconds: Math.round((Date.now() - this.started) / 100) / 10,
      active_connections: this.active.ws + this.active.sse,
      active_by_protocol: { ...this.active },
      connections_opened: this.connectionsOpened,
      connections_closed: this.connectionsClosed,
      total_messages: this.totalMessages,
      messages_per_second_last_10s: this.messagesPerSecond(),
      bytes_in: this.bytesIn,
      bytes_out: this.bytesOut,
    };
  }
}