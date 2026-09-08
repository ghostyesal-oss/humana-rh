// Edge Function : rappel Web Push aux collaborateurs qui n'ont pas encore pointe
// leur arrivee 3 minutes apres leur heure de shift (CS 09:03, R&D 10:03).
//
// Deploy :
//   supabase functions deploy late-punch-reminder --no-verify-jwt
//
// Variables d'environnement a definir (Project Settings > Functions > Secrets) :
//   VAPID_PUBLIC_KEY   Cle publique VAPID (aussi utilisee cote client).
//   VAPID_PRIVATE_KEY  Cle privee VAPID (jamais exposee au client).
//   VAPID_SUBJECT      mailto:rh@humaine.fr (contact push)
//   SUPABASE_URL       Auto-injectee par la runtime.
//   SUPABASE_SERVICE_ROLE_KEY  Auto-injectee par la runtime.
//
// Planification (Supabase Dashboard > Database > Cron) : toutes les minutes
//   entre 09:00 et 11:00 heure de Paris (adaptez selon vos shifts).

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "https://esm.sh/web-push@3.6.7?target=deno";

const SHIFT_PRESETS: Record<string, { start: string; label: string }> = {
  cs: { start: "09:00", label: "CS / CES" },
  rnd: { start: "10:00", label: "R&D" }
};

const LATE_OFFSET_MIN = 3;

function toParisNow(): Date {
  // Deno n'a pas de timezone builtin ; on utilise l'astuce Intl.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  const parts = formatter.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const iso = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
  return new Date(iso);
}

function shiftForProfile(profile: any): { start: string } {
  const code = String(profile?.shift_code || "").toLowerCase();
  if (SHIFT_PRESETS[code]) return SHIFT_PRESETS[code];
  const dept = String(profile?.department || profile?.job_title || "").toLowerCase();
  if (dept.includes("r&d") || dept.includes("r et d") || /\brd\b/.test(dept)) return SHIFT_PRESETS.rnd;
  return SHIFT_PRESETS.cs;
}

function minutesFromHhmm(value: string): number {
  const [h, m] = String(value || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:rh@humaine.fr";

  if (!supabaseUrl || !serviceKey || !vapidPublic || !vapidPrivate) {
    return new Response("Missing environment variables", { status: 500 });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const now = toParisNow();

  if (isWeekend(now)) {
    return new Response(JSON.stringify({ ok: true, skipped: "weekend" }), { status: 200 });
  }

  const dayKey = toDateKey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, email, department, job_title, shift_code");
  if (profilesError) return new Response(profilesError.message, { status: 500 });

  const startIso = `${dayKey}T00:00:00`;
  const endIso = `${dayKey}T23:59:59`;
  const { data: punches, error: punchesError } = await supabase
    .from("time_punches")
    .select("user_id, punch_type, punched_at")
    .gte("punched_at", startIso)
    .lte("punched_at", endIso)
    .eq("punch_type", "in");
  if (punchesError) return new Response(punchesError.message, { status: 500 });

  const pointedUsers = new Set((punches || []).map((row) => row.user_id));
  const targets = (profiles || []).filter((profile) => {
    if (pointedUsers.has(profile.id)) return false;
    const shift = shiftForProfile(profile);
    const shiftStart = minutesFromHhmm(shift.start);
    return nowMin >= shiftStart + LATE_OFFSET_MIN && nowMin < shiftStart + 180;
  });

  if (!targets.length) {
    return new Response(JSON.stringify({ ok: true, matched: 0 }), { status: 200 });
  }

  const userIds = targets.map((profile) => profile.id);
  const { data: subs, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("*")
    .in("user_id", userIds);
  if (subsError) return new Response(subsError.message, { status: 500 });

  const subsByUser = new Map<string, any[]>();
  (subs || []).forEach((sub) => {
    if (!subsByUser.has(sub.user_id)) subsByUser.set(sub.user_id, []);
    subsByUser.get(sub.user_id)!.push(sub);
  });

  let sent = 0;
  let dead = 0;

  for (const profile of targets) {
    const list = subsByUser.get(profile.id) || [];
    const shift = shiftForProfile(profile);
    const shiftStart = minutesFromHhmm(shift.start);
    const delay = nowMin - shiftStart;
    const payload = JSON.stringify({
      title: "⏰ Pointage oublié",
      body: `Bonjour ${profile.full_name?.split(" ")[0] || ""}, tu n'as pas encore pointé (retard : ${delay} min).`,
      url: "/",
      tag: `humana-late-${dayKey}`
    });

    for (const sub of list) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        }, payload);
        sent += 1;
      } catch (err: any) {
        dead += 1;
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, matched: targets.length, sent, dead }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
});
