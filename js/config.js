// Cấu hình kết nối. Khoá "publishable/anon" của Supabase là khoá công khai,
// được thiết kế để nằm trong code trình duyệt; dữ liệu được bảo vệ bằng RLS.
export const CONFIG = {
  SUPABASE_URL: '__SUPABASE_URL__',
  SUPABASE_KEY: '__SUPABASE_PUBLISHABLE_KEY__',
  APP_VERSION: '1.0.0',
  MAX_VIDEO_SEC: 15,
  MAX_VIDEO_MB: 50,
  STORAGE_LIMIT_MB: 1024, // gói Free của Supabase: 1GB
};

CONFIG.FUNCTIONS_URL = `${CONFIG.SUPABASE_URL}/functions/v1`;
CONFIG.CONFIGURED = !CONFIG.SUPABASE_URL.startsWith('__');
