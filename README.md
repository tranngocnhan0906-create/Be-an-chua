# Bé ăn chưa? 🐱🍚

Nhật ký bữa ăn của hai đứa mình: mỗi bữa (sáng, trưa, chiều, tối, khuya) chụp một tấm ảnh hoặc quay video ngắn, kèm giờ đăng. Chỉ hai tài khoản (có mã mời) xem được.

## Tính năng
- Đăng ảnh/video theo bữa, tự xếp bữa theo giờ, ảnh tự nén (~300KB), video ≤ 15 giây
- Màn hình **Hôm nay**: 5 bữa của cả hai, tiến độ 3 bữa chính
- **Nhật ký** theo tháng, **Hai đứa**: đếm ngày yêu, chuỗi ngày ăn đủ bữa
- Thả tim, bình luận, cập nhật tức thời
- **Tin nhắn** riêng hai người: trả lời nhanh, đã xem, thu hồi, huy hiệu chưa đọc
- Nhắc giờ ăn hiện cả trong khung chat, có nút **Gửi báo cáo cho {chủ app}** để chụp ảnh đăng ra trang chủ
- Thông báo đẩy: bài mới, tim, bình luận, tin nhắn, nhắc giờ ăn (cron 10 phút)
- Cài như app trên iPhone (Safari → Thêm vào MH chính) và Android

## Cấu trúc
```
index.html, css/, js/          Giao diện (HTML/CSS/JS thuần, không cần build)
js/config.js                   Địa chỉ Supabase + khoá công khai (publishable)
js/vendor/supabase.js          Thư viện supabase-js đóng gói sẵn
sw.js, manifest.webmanifest    PWA: cài app, offline, nhận thông báo
supabase/schema.sql            Bảng, phân quyền (RLS), kho ảnh, realtime, trigger
supabase/setup.sql             Cấu hình sau khi deploy: URL function, mã mời, cron
supabase/chat.sql              Bản 1.1: bảng tin nhắn, liên kết nhắc giờ ăn ↔ bài báo cáo
supabase/functions/notify/     Edge Function gửi Web Push (WebCrypto, không thư viện ngoài)
```

## Dựng lại từ đầu
1. Tạo project Supabase (gói Free, vùng Singapore), chạy `supabase/schema.sql` rồi `supabase/chat.sql`.
2. Deploy function `supabase/functions/notify` với **verify_jwt = false**.
3. Chạy `supabase/setup.sql` (thay `__REF__`, `__SITE__`, `__INVITE__`).
4. Authentication → Sign In / Providers → Email → tắt **Confirm email**.
5. Điền `SUPABASE_URL` và khoá publishable vào `js/config.js`, đẩy lên GitHub, bật GitHub Pages (nhánh `main`, thư mục gốc).
