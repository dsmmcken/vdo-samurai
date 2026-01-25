// Samurai / Ancient Japan themed word lists (64 each = 2^6 = 6 bits entropy per list)
const verbs = [
  'striking',
  'defending',
  'charging',
  'meditating',
  'training',
  'dueling',
  'slashing',
  'guarding',
  'honoring',
  'serving',
  'forging',
  'mastering',
  'conquering',
  'protecting',
  'advancing',
  'retreating',
  'ambushing',
  'scouting',
  'rallying',
  'sieging',
  'bowing',
  'kneeling',
  'watching',
  'waiting',
  'stalking',
  'hunting',
  'riding',
  'marching',
  'patrolling',
  'standing',
  'falling',
  'rising',
  'flowing',
  'parrying',
  'dodging',
  'leaping',
  'rolling',
  'crouching',
  'sprinting',
  'climbing',
  'swimming',
  'sailing',
  'rowing',
  'casting',
  'brewing',
  'crafting',
  'painting',
  'writing',
  'chanting',
  'praying',
  'blessing',
  'summoning',
  'banishing',
  'pursuing',
  'fleeing',
  'encircling',
  'flanking',
  'feinting',
  'blocking',
  'countering',
  'executing',
  'avenging',
  'liberating',
  'unifying',
];

const adjectives = [
  'noble',
  'fierce',
  'silent',
  'swift',
  'loyal',
  'fearless',
  'ancient',
  'sacred',
  'hidden',
  'shadow',
  'crimson',
  'golden',
  'iron',
  'steel',
  'jade',
  'ivory',
  'obsidian',
  'amber',
  'scarlet',
  'midnight',
  'eternal',
  'vengeful',
  'tranquil',
  'mighty',
  'humble',
  'stoic',
  'vigilant',
  'ruthless',
  'patient',
  'cunning',
  'valiant',
  'honored',
  'fallen',
  'risen',
  'wandering',
  'exiled',
  'legendary',
  'phantom',
  'celestial',
  'earthen',
  'blessed',
  'cursed',
  'radiant',
  'somber',
  'blazing',
  'frozen',
  'misty',
  'serene',
  'divine',
  'mortal',
  'spectral',
  'primal',
  'mystic',
  'feral',
  'solemn',
  'defiant',
  'wrathful',
  'graceful',
  'hollow',
  'verdant',
  'ashen',
  'silvered',
  'bloodied',
  'unbroken',
];

const nouns = [
  'samurai',
  'shogun',
  'ronin',
  'ninja',
  'daimyo',
  'sensei',
  'geisha',
  'monk',
  'emperor',
  'warrior',
  'katana',
  'wakizashi',
  'tanto',
  'naginata',
  'yumi',
  'shuriken',
  'kunai',
  'tessen',
  'castle',
  'fortress',
  'temple',
  'shrine',
  'dojo',
  'palace',
  'pagoda',
  'bridge',
  'garden',
  'mountain',
  'river',
  'bamboo',
  'cherry',
  'lotus',
  'crane',
  'dragon',
  'tiger',
  'phoenix',
  'koi',
  'wolf',
  'hawk',
  'serpent',
  'spirit',
  'flame',
  'wind',
  'moon',
  'sun',
  'star',
  'dawn',
  'dusk',
  'tsunami',
  'typhoon',
  'blossom',
  'petal',
  'lantern',
  'scroll',
  'banner',
  'armor',
  'helm',
  'mask',
  'fan',
  'bell',
  'gate',
  'path',
  'blade',
  'shadow',
];

function randomIndex(length: number): number {
  const randomBytes = new Uint8Array(1);
  crypto.getRandomValues(randomBytes);
  return randomBytes[0] % length;
}

// Password delimiter for room codes
const PASSWORD_DELIMITER = '?p=';

// Generate cryptographically secure password (12 chars alphanumeric)
export function generatePassword(): string {
  const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const values = new Uint8Array(12);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => charset[v % charset.length]).join('');
}

// Parsed room code structure
export interface ParsedRoomCode {
  roomId: string;
  password: string;
}

// Parse "roomcode?p=password" format
export function parseRoomCode(input: string): ParsedRoomCode {
  const idx = input.lastIndexOf(PASSWORD_DELIMITER);
  if (idx === -1) {
    // No password found - generate one (for creating new rooms from legacy codes)
    return { roomId: input, password: generatePassword() };
  }
  return {
    roomId: input.substring(0, idx),
    password: input.substring(idx + PASSWORD_DELIMITER.length)
  };
}

// Format room ID and password for sharing
export function formatRoomCode(roomId: string, password: string): string {
  return `${roomId}${PASSWORD_DELIMITER}${password}`;
}

// Generate room code with password included
export function generateRoomCode(): string {
  const verb = verbs[randomIndex(verbs.length)];
  const adjective = adjectives[randomIndex(adjectives.length)];
  const noun = nouns[randomIndex(nouns.length)];
  const shortId = crypto.randomUUID().split('-')[0];
  const password = generatePassword();

  return `${verb}-${adjective}-${noun}-${shortId}${PASSWORD_DELIMITER}${password}`;
}
