import type { Place } from '@/src/navigation';

export type Invitation = {
  sender: 'Basia' | 'Danka';
  text: string;
  createdAt: number;
};

const invitations: Omit<Invitation, 'createdAt'>[] = [
  {
    sender: 'Basia',
    text: 'Jadwigo, jestem w parku Morskie Oko na Starym Mokotowie. Przyjdź do mnie, posiedzimy razem. Basia',
  },
  {
    sender: 'Basia',
    text: 'Jadwigo, masz ochotę na spotkanie? Czekam w parku Morskie Oko na Starym Mokotowie. Dołącz do mnie! Basia',
  },
  {
    sender: 'Danka',
    text: 'Jadwigo, zapraszam Cię do mnie na ciasto. Jestem w domu, w naszym bloku. Danka',
  },
  {
    sender: 'Danka',
    text: 'Jadwigo, wpadnij do mnie na kawałek ciasta i pogaduszki. To blisko, w tym samym bloku. Danka',
  },
];

export function randomInvitation(random = Math.random, now = Date.now()): Invitation {
  return { ...invitations[Math.floor(random() * invitations.length)]!, createdAt: now };
}

export function createTripleTap() {
  let taps: number[] = [];
  return (now: number): boolean => {
    taps = [...taps.filter((time) => now - time <= 1200), now];
    if (taps.length < 3) return false;
    taps = [];
    return true;
  };
}

// Demo meeting points, fixed geographically; these are not live friend locations.
// Sources: https://mapa.targeo.pl/raclawicka-17--ul/warszawa-02-601/ulica
// https://mapcarta.com/W1426697668 (park reference point, not a confirmed entrance).
export const INVITATION_DESTINATIONS: Readonly<Record<Invitation['sender'], Place>> = Object.freeze(
  {
    Danka: Object.freeze({
      id: 'danka-home',
      name: 'Danka',
      address: 'ul. Racławicka 17, Warszawa',
      location: Object.freeze({ latitude: 52.19902, longitude: 21.0197395 }),
    }),
    Basia: Object.freeze({
      id: 'basia-park',
      name: 'Basia — park Morskie Oko',
      address: 'Park Morskie Oko, Warszawa',
      location: Object.freeze({ latitude: 52.20708, longitude: 21.02617 }),
    }),
  },
);
