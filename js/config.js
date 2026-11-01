// Cấu hình kết nối. Khoá "publishable/anon" của Supabase là khoá công khai,
// được thiết kế để nằm trong code trình duyệt; dữ liệu được bảo vệ bằng RLS.
export const CONFIG = {
  SUPABASE_URL: 'https://zhilaokwziowyblfimjr.supabase.co',
  SUPABASE_KEY: 'sb_publishable_6Mckw0nyXt6gDpCNNFo2Pw_VdEyQ6VM',
  APP_VERSION: '2.0.0',
  MAX_VIDEO_SEC: 15,
  MAX_VIDEO_MB: 50,
  STORAGE_LIMIT_MB: 1024, // gói Free của Supabase: 1GB
};

CONFIG.FUNCTIONS_URL = `${CONFIG.SUPABASE_URL}/functions/v1`;
CONFIG.CONFIGURED = !CONFIG.SUPABASE_URL.startsWith('__');
