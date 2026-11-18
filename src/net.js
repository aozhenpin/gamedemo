export class Net {
  constructor(handlers) {
    this.handlers = handlers || {};
    this.ws = null;
  }

  join(code, name) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}`);
    this.ws.onopen = () => this.send({ t: 'join', code, name });
    this.ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      const fn = this.handlers[msg.t];
      if (fn) fn(msg);
      else this.handlers.onMessage?.(msg);
    };
    this.ws.onclose = () => this.handlers.onClose?.();
    this.ws.onerror = () => this.handlers.onError?.();
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  hide(x, z, yaw, spotId = -1, y = 0) {
    this.send({ t: 'hide', x, y, z, yaw, spotId });
  }

  found() {
    this.send({ t: 'found' });
  }

  died() {
    this.send({ t: 'died' });
  }

  timeout() {
    this.send({ t: 'timeout' });
  }

  again() {
    this.send({ t: 'again' });
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }
}
