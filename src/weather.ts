// Spoken conditions report from Open-Meteo (free, no key).

import type { LatLon } from './geo';
import type { Units } from './settings';

const TTL = 10 * 60_000;
const TIMEOUT = 6000;

interface Forecast {
  current: { time: string; temperature_2m: number; weather_code: number; wind_speed_10m: number; is_day: number };
  daily: { sunrise: string[]; sunset: string[] };
}

const cache = new Map<string, { at: number; data: Forecast }>();

function describe(code: number): string {
  if (code === 0) return 'clear';
  if (code <= 2) return 'mostly clear';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'foggy';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code === 61 || code === 80) return 'light rain';
  if (code === 63 || code === 81) return 'rain';
  if (code === 65 || code === 82 || code === 66 || code === 67) return 'heavy rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code === 85 || code === 86) return 'snow showers';
  if (code >= 95) return 'thunderstorms';
  return 'unsettled';
}

async function load(p: LatLon, units: Units): Promise<Forecast> {
  const imp = units === 'imperial';
  const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)},${units}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(4)}&longitude=${p.lon.toFixed(4)}` +
    `&current=temperature_2m,weather_code,wind_speed_10m,is_day&daily=sunrise,sunset&timezone=auto&forecast_days=2` +
    (imp ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '&wind_speed_unit=kmh');
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(String(res.status));
  const data = (await res.json()) as Forecast;
  cache.set(key, { at: Date.now(), data });
  return data;
}

export async function conditionsReport(p: LatLon, units: Units): Promise<string> {
  let f: Forecast;
  try {
    f = await load(p, units);
  } catch {
    return 'Conditions are unavailable. Check your connection.';
  }
  const imp = units === 'imperial';
  const c = f.current;
  const parts = [`${Math.round(c.temperature_2m)} degrees ${imp ? 'Fahrenheit' : 'Celsius'}, ${describe(c.weather_code)}`];
  const wind = Math.round(c.wind_speed_10m);
  if (wind >= (imp ? 12 : 20)) parts.push(`${wind >= (imp ? 25 : 40) ? 'strong wind' : 'windy'}, ${wind} ${imp ? 'miles per hour' : 'kilometres per hour'}`);

  // times are local to the location and carry no offset, so compare them with each other only
  const now = Date.parse(c.time);
  const clock = (iso: string) => iso.slice(11, 16);
  const nextSet = f.daily.sunset.findIndex((t) => Date.parse(t) > now);
  if (c.is_day && nextSet >= 0) {
    const mins = Math.round((Date.parse(f.daily.sunset[nextSet]) - now) / 60_000);
    parts.push(`daylight, sunset at ${clock(f.daily.sunset[nextSet])}${mins <= 60 ? `, in ${mins} minutes` : ''}`);
  } else {
    const nextRise = f.daily.sunrise.findIndex((t) => Date.parse(t) > now);
    parts.push(`dark${nextRise >= 0 ? `, sunrise at ${clock(f.daily.sunrise[nextRise])}` : ''}`);
  }
  return parts.join('. ') + '.';
}
