// ============================================================
//  VERCEL ENTRY POINT
//
//  Anything in this /api folder becomes a serverless function
//  on Vercel. This one hands over the same Express app that
//  runs locally, so there is ONE payment implementation, not
//  a copy that quietly drifts out of step.
//
//  server.js only calls listen() when node is pointed straight
//  at it, so importing it here starts no port and no process
//  that hangs around.
//
//  WHAT DOES NOT WORK HERE, and it matters:
//  the email worker. It relies on setInterval in a process
//  that stays alive, and a serverless function is torn down
//  after each request. On Vercel it simply never runs, and
//  notifications stay in-app only. If email matters, that job
//  needs somewhere that stays up — a small always-on host, or
//  Supabase pg_cron calling an Edge Function.
// ============================================================

module.exports = require('../server/server.js');
