import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';
// One auth client per browser context; all modules share token refresh and session state.
export const supabase=createClient('https://afhnfnfbqdqqzrghovfc.supabase.co','sb_publishable_4GStzbYK3_BhthidusT_hw_DqtzC7qE',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
