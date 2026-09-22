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
  h7: { start: "07:00", label: "07h–17h" },
  h8: { start: "08:00", label: "08h–18h" },
  cs: { start: "08:00", label: "CS / CES" },
  ces: { start: "08:00", label: "CES" },
  rnd: { start: "09:00", label: "R&D" }
};

const LATE_OFFSET_MIN = 3;

function companyOffsetMinutes(timezone: string): number {
  return timezone === "GMT" ? 0 : 60;
}

function toCompanyNow(offsetMinutes: number): Date {
  return new Date(Date.now() + offsetMinutes * 60000);
}

function profileShiftKey(profile: any): string {
  const code = String(profile?.shift_code || "").toLowerCase();
  if (SHIFT_PRESETS[code]) return code;
  const dept = String(profile?.department || profile?.job_title || "").toLowerCase();
  if (dept.includes("r&d") || dept.includes("r et d") || /\brd\b/.test(dept)) return "rnd";
  if (/\bces\b/.test(dept)) return "ces";
  return "cs";
}

function shiftForProfile(profile: any, overrides: Record<string, { start?: string }> = {}): { start: string } {
  const key = profileShiftKey(profile);
  const start = overrides[key]?.start || SHIFT_PRESETS[key].start;
  return { start };
}

function minutesFromHhmm(value: string): number {
  const [h, m] = String(value || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function toDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
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
  const { data: settings } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ["company_timezone", "gta_shifts"]);
  const timezoneRaw = (settings || []).find((row) => row.key === "company_timezone")?.value;
  const timezone = (typeof timezoneRaw === "string" ? timezoneRaw : timezoneRaw?.id || timezoneRaw?.timezone) === "GMT"
    ? "GMT"
    : "GMT+1";
  const shiftOverrides = ((settings || []).find((row) => row.key === "gta_shifts")?.value || {}) as Record<string, { start?: string }>;
  const now = toCompanyNow(companyOffsetMinutes(timezone));
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();

  if (isWeekend(now)) {
    return new Response(JSON.stringify({ ok: true, skipped: "weekend" }), { status: 200 });
  }

  const dayKey = toDateKey(now);

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
    const shift = shiftForProfile(profile, shiftOverrides);
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
    const shift = shiftForProfile(profile, shiftOverrides);
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
