export const P2P_CONFIG = {
  appId: 'vdo-samurai-v1',
  relayUrls: [
    'wss://nostr.mutinywallet.com',
    'wss://relay.nostr.band',
    'wss://nostr-pub.wellorder.net'
  ]
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
