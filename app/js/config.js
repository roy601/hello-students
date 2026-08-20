// ============================================================
//  STEP 1 OF SETUP — put your Supabase keys here.
//
//  Find them in: Supabase Dashboard > Project Settings > API
//  The "anon public" key is safe to put in front-end code.
//  Row Level Security (see db/schema.sql) is what protects data.
// ============================================================

// ============================================================
//  HOW PAYMENTS WORK
//
//  The browser never talks to the payment gateway. It asks our
//  own server, and the server holds the secret key and decides
//  which gateway to use (PAYMENT_PROVIDER in server/.env).
//
//  There is deliberately no "demo" or "test" switch here. One
//  used to exist and it marked orders paid without any money
//  moving. To try the flow safely, point the SERVER at the
//  gateway's sandbox instead — real code path, no real taka.
// ============================================================

export const PAYMENT_SERVER_URL = '';

export const SUPABASE_URL = 'https://fdbhieucrccvnzykpnpg.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkYmhpZXVjcmNjdm56eWtwbnBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNzMzMTIsImV4cCI6MjEwMTk0OTMxMn0.KmSjdUJPfO20cqpvvduJ9JKe_tsoYOGsskVg5Te_vQ8';
