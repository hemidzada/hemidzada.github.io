// panda.az daily puzzle leaderboard (Supabase edge function "site-daily").
//   POST /start  {game, day}         -> {id}           server starts the clock
//   POST /finish {id, answer}        -> {ms, rank, total, counted}
//   POST /name   {id, name}          -> {ok}            top 100 only
//   GET  /top?game=&day=&me=<id>     -> {total, top: [{rank, name, ms, me}]}
// The answer is checked against the regenerated daily board, the time is
// measured on the server, only the first solve per player per board counts.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { dailyPuzzle, isSolved } from './logic.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const SALT = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!.slice(-24);
const GAMES = ['queens', 'zip', 'tango'];
const RANKED_FROM = '2026-10-23';
const MIN_MS = 5000;
const MAX_MS = 6 * 3600e3;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS, ...extra } });
const fail = (error: string, status = 400) => json({ error }, status);

const bakuDay = (offset = 0) => new Date(Date.now() + 4 * 3600e3 + offset * 864e5).toISOString().slice(0, 10);
const openDay = (day: string) => day >= RANKED_FROM && (day === bakuDay() || day === bakuDay(-1));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function ipHash(req: Request, day: string) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|${day}|${SALT}`));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const puzzles = new Map<string, unknown>();
function puzzle(game: string, day: string) {
  const k = game + day;
  if (!puzzles.has(k)) puzzles.set(k, dailyPuzzle(game, day));
  return puzzles.get(k);
}

// Lower-cased, de-leeted substrings that block a name.
const BLOCK = [
  'fuck', 'shit', 'bitch', 'cunt', 'pussy', 'nigg', 'fag', 'whore', 'slut', 'nazi', 'hitler',
  'porn', 'penis', 'vagina', 'asshole', 'bastard', 'retard',
  'amcig', 'amcık', 'sikdir', 'sikim', 'orospu', 'piç', 'götveren', 'qəhbə', 'qehbe', 'gijdillaq', 'blyat', 'blyad', 'suka', 'pizd', 'xuy', 'ебан', 'хуй', 'пизд', 'бля', 'сука',
  'admin', 'moderator', 'panda.az', 'http', 'www',
];
function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,15}$/u.test(name)) return null;
  const flat = name.toLowerCase().replace(/[0@]/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/[ ._-]/g, '');
  if (BLOCK.some((w) => flat.includes(w.replace(/[ .]/g, '')))) return null;
  return name;
}

async function rankOf(game: string, day: string, ms: number) {
  const [{ count: better }, { count: total }] = await Promise.all([
    db.from('site_daily_runs').select('id', { count: 'exact', head: true }).eq('game', game).eq('day', day).eq('counted', true).lt('ms', ms),
    db.from('site_daily_runs').select('id', { count: 'exact', head: true }).eq('game', game).eq('day', day).eq('counted', true),
  ]);
  return { rank: (better ?? 0) + 1, total: total ?? 0 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const route = url.pathname.split('/').pop();
  try {
    if (req.method === 'GET' && route === 'top') {
      const game = url.searchParams.get('game') ?? '', day = url.searchParams.get('day') ?? '';
      const me = url.searchParams.get('me') ?? '';
      if (!GAMES.includes(game) || !/^\d{4}-\d\d-\d\d$/.test(day)) return fail('bad_request');
      const { data, error } = await db.from('site_daily_runs').select('id, name, ms')
        .eq('game', game).eq('day', day).eq('counted', true).order('ms').order('finished_at').limit(100);
      if (error) throw error;
      const { count } = await db.from('site_daily_runs').select('id', { count: 'exact', head: true })
        .eq('game', game).eq('day', day).eq('counted', true);
      return json({
        total: count ?? 0,
        top: data.map((r, k) => ({ rank: k + 1, name: r.name, ms: r.ms, me: r.id === me })),
      }, 200, { 'cache-control': me ? 'no-store' : 'public, max-age=15' });
    }
    if (req.method !== 'POST') return fail('not_found', 404);
    const body = await req.json().catch(() => ({}));

    if (route === 'start') {
      const { game, day } = body;
      if (!GAMES.includes(game) || typeof day !== 'string' || !openDay(day)) return fail('closed');
      const ip_hash = await ipHash(req, day);
      const since = new Date(Date.now() - 10 * 60e3).toISOString();
      const { count } = await db.from('site_daily_runs').select('id', { count: 'exact', head: true })
        .eq('ip_hash', ip_hash).gte('started_at', since);
      if ((count ?? 0) >= 30) return fail('slow_down', 429);
      const { data, error } = await db.from('site_daily_runs').insert({ game, day, ip_hash }).select('id').single();
      if (error) throw error;
      return json({ id: data.id });
    }

    if (route === 'finish') {
      if (typeof body.id !== 'string' || !UUID.test(body.id)) return fail('bad_request');
      const { data: run } = await db.from('site_daily_runs').select('*').eq('id', body.id).maybeSingle();
      if (!run || run.finished_at) return fail('bad_run');
      if (!openDay(run.day)) return fail('closed');
      const ms = Date.now() - Date.parse(run.started_at);
      if (ms < MIN_MS || ms > MAX_MS) return fail('bad_time');
      if (!isSolved(puzzle(run.game, run.day), body.answer)) return fail('wrong');
      const { count: prior } = await db.from('site_daily_runs').select('id', { count: 'exact', head: true })
        .eq('game', run.game).eq('day', run.day).eq('ip_hash', run.ip_hash).eq('counted', true);
      let counted = !prior;
      const upd = await db.from('site_daily_runs').update({ finished_at: new Date().toISOString(), ms, counted }).eq('id', run.id);
      if (upd.error) {
        // Lost a race with another tab: keep the time, unranked.
        counted = false;
        await db.from('site_daily_runs').update({ finished_at: new Date().toISOString(), ms, counted }).eq('id', run.id);
      }
      const { rank, total } = await rankOf(run.game, run.day, ms);
      return json({ ms, counted, rank, total });
    }

    if (route === 'name') {
      if (typeof body.id !== 'string' || !UUID.test(body.id)) return fail('bad_request');
      const name = cleanName(body.name);
      if (!name) return fail('bad_name');
      const { data: run } = await db.from('site_daily_runs').select('*').eq('id', body.id).maybeSingle();
      if (!run || !run.counted || run.name) return fail('bad_run');
      const { rank } = await rankOf(run.game, run.day, run.ms);
      if (rank > 100) return fail('not_top');
      const { error } = await db.from('site_daily_runs').update({ name, named_at: new Date().toISOString() }).eq('id', run.id).is('name', null);
      if (error) throw error;
      return json({ ok: true });
    }
    return fail('not_found', 404);
  } catch (e) {
    console.error(e);
    return fail('server', 500);
  }
});
