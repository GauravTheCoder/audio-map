// Spoken next departures near a stop from Transitous (MOTIS), an open feed with no key.

import type { LatLon } from './geo';

export interface Departure {
  line: string;
  to: string;
  at: Date;
  live: boolean;
}

export interface DepartureFeed {
  covers(lat: number, lon: number): boolean;
  departures(stop: LatLon): Promise<Departure[]>;
}

const TIMEOUT = 5000;

interface StopTime {
  headsign?: string;
  realTime?: boolean;
  displayName?: string;
  routeShortName?: string;
  place: { departure?: string; scheduledDeparture?: string };
}

// Transitous is a worldwide aggregate with no hard border, so an empty answer means no data.
export const transitous: DepartureFeed = {
  covers: () => true,
  async departures({ lat, lon }) {
    const url = `https://api.transitous.org/api/v5/stoptimes?center=${lat.toFixed(5)},${lon.toFixed(5)}&radius=50&n=4`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { stopTimes?: StopTime[] };
    return (data.stopTimes ?? []).map((s) => ({
      line: s.displayName ?? s.routeShortName ?? '',
      to: s.headsign ?? '',
      at: new Date(s.place.departure ?? s.place.scheduledDeparture ?? NaN),
      live: !!s.realTime,
    }));
  },
};

export async function departuresReport(feed: DepartureFeed, stop: { name: string } & LatLon, now = Date.now()): Promise<string> {
  if (!feed.covers(stop.lat, stop.lon)) return 'No departure data here.';
  let list: Departure[];
  try {
    list = await feed.departures(stop);
  } catch {
    return 'Departures are unavailable. Check your connection.';
  }
  const items = list
    .filter((d) => !isNaN(d.at.getTime()))
    .map((d) => {
      const m = Math.max(0, Math.round((d.at.getTime() - now) / 60000));
      const when = m === 0 ? 'now' : m === 1 ? 'in 1 minute' : `in ${m} minutes`;
      return `${[d.line, d.to && `to ${d.to}`].filter(Boolean).join(' ') || 'Service'} ${when}`;
    });
  if (!items.length) return 'No departure data here.';
  return `Next departures from ${stop.name}: ${items.join('. ')}.`;
}
