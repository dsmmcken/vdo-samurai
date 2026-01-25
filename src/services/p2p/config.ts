export const P2P_CONFIG = {
  appId: 'vdo-samurai-v1'
  // Uses Nostr default relays (18 relays including relay.damus.io, nos.lol, etc.)
};

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ]
};
