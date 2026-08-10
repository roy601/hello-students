// ============================================================
//  Creates ONE Supabase client that every page reuses.
//  Every other file does:  import { supabase } from './supabase.js'
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
