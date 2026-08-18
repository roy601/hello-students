// ============================================================
//  STEP 1 OF SETUP — put your Supabase keys here.
//
//  Find them in: Supabase Dashboard > Project Settings > API
//  The "anon public" key is safe to put in front-end code.
//  Row Level Security (see db/schema.sql) is what protects data.
// ============================================================

// ============================================================
//  HOW PAYMENTS WORK RIGHT NOW
//
//    'demo'        no gateway, no server needed. The order is
//                  marked paid straight away so the project
//                  can be shown working.
//
//    'sslcommerz'  the real thing. Needs the payment server
//                  running (npm start) with your store id and
//                  password in server/.env
//
//  Change this ONE word when your SSLCommerz account is ready.
// ============================================================
export const GATEWAY_MODE = 'demo';

// The payment API is served by the same server as this page,
// so it needs no address at all. Only set this if you ever
// host the API somewhere separate.
export const PAYMENT_SERVER_URL = '';

export const SUPABASE_URL = 'https://fdbhieucrccvnzykpnpg.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkYmhpZXVjcmNjdm56eWtwbnBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNzMzMTIsImV4cCI6MjEwMTk0OTMxMn0.KmSjdUJPfO20cqpvvduJ9JKe_tsoYOGsskVg5Te_vQ8';
