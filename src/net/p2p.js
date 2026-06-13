// Peer-to-Peer networking with a Designated Authority Client (DAC).
//
// Per the Technical Mandate: P2P to avoid server dependencies, with the host as
// the sole authority over game state. We use the browser's native WebRTC
// (RTCPeerConnection + a reliable DataChannel) — zero dependencies. Because no
// signaling server is available, peers exchange the connection offer/answer
// (SDP) manually by copy/paste through the Network panel.
//
// Roles:
//   HOST  — runs applyTick (the authority), broadcasts JSON state snapshots,
//           and is the only peer that mutates game state. Validates guest intents.
//   GUEST — renders received snapshots and sends intents (place/upgrade) to the
//           host. Never mutates authoritative state locally.
//
// Wire format (one JSON object per message):
//   { t: 'snapshot', state }      host -> guest
//   { t: 'intent', kind, args }   guest -> host

const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Wait for ICE gathering to finish so the SDP we hand out is fully populated
// (trickle ICE needs a signaling channel we don't have).
function waitForIce(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') resolve();
    });
  });
}

export class Net {
  constructor() {
    this.role = null;       // 'host' | 'guest'
    this.pc = null;
    this.channel = null;
    this.onSnapshot = () => {};
    this.onIntent = () => {};
    this.onStatus = () => {};
  }

  get connected() { return this.channel && this.channel.readyState === 'open'; }

  _bindChannel(ch) {
    this.channel = ch;
    ch.addEventListener('open', () => this.onStatus('connected'));
    ch.addEventListener('close', () => this.onStatus('disconnected'));
    ch.addEventListener('message', (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'snapshot') this.onSnapshot(msg.state);
      else if (msg.t === 'intent') this.onIntent(msg.kind, msg.args);
    });
  }

  // HOST: create the connection + data channel, return the offer SDP to share.
  async host() {
    this.role = 'host';
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this._bindChannel(this.pc.createDataChannel('arcane', { ordered: true }));
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await waitForIce(this.pc);
    return JSON.stringify(this.pc.localDescription);
  }

  // HOST: finalize once the guest's answer is pasted back.
  async acceptAnswer(answerJson) {
    await this.pc.setRemoteDescription(JSON.parse(answerJson));
  }

  // GUEST: consume the host's offer, return the answer SDP to share back.
  async join(offerJson) {
    this.role = 'guest';
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc.addEventListener('datachannel', (e) => this._bindChannel(e.channel));
    await this.pc.setRemoteDescription(JSON.parse(offerJson));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitForIce(this.pc);
    return JSON.stringify(this.pc.localDescription);
  }

  // HOST: broadcast the authoritative snapshot to the guest.
  broadcast(state) {
    if (this.connected && this.role === 'host') {
      this.channel.send(JSON.stringify({ t: 'snapshot', state }));
    }
  }

  // GUEST: send an intent for the host to validate and apply.
  sendIntent(kind, args) {
    if (this.connected && this.role === 'guest') {
      this.channel.send(JSON.stringify({ t: 'intent', kind, args }));
    }
  }
}
