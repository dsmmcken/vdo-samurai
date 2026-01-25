export const P2P_CONFIG = {
  appId: 'vdo-samurai-v1',
  relayUrls: [
    'wss://tracker.openwebtorrent.com:443/announce',
    'wss://tracker.magnetoo.io:443/announce',
    'wss://tracker.files.fm:7073/announce',
    'wss://spacetradersapi-chatbox.herokuapp.com:443/announce'
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
