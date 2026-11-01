# Bé ăn chưa? 🐱🍚

App nhỏ cho hai đứa mình: theo dõi giờ ăn của Ny, nhắn tin riêng và lịch "chị 🍓". Chỉ hai tài khoản (có mã mời) xem được. Người tạo tài khoản đầu tiên là **chủ app**, người thứ hai là **Ny**.

## Tính năng (bản 2.0)
- **Lịch ăn** (tab trái): ba bữa chính của Ny theo giờ ăn chuẩn (mặc định 07:30 · 12:00 · 19:00, đổi trong Cài đặt)
  - Mỗi bữa hiện giờ đăng hình và trễ/sớm bao lâu so với giờ ăn
  - Quá giờ chưa có hình: thẻ **báo đỏ** kèm số phút trễ; ngày đã qua mà thiếu hình: "Bỏ bữa"
  - Đổi sang ngày khác bằng ‹ ›, xem cả tháng với chấm xanh/cam/đỏ và thống kê
  - Chỉ Ny chụp/đăng báo cáo; chủ app xem, thả tim, bình luận, bấm "Nhắn nhắc ngay"
- **Tin nhắn** (nút tròn ở giữa): chữ, ảnh, video; trả lời nhanh, đã xem, thu hồi
  - Mỗi bài báo cáo, lượt thả tim, bình luận ảnh bữa ăn đều hiện trong khung chat
  - Mèo nhắc giờ ăn ngay trong chat (trễ 15 phút và trễ 1 tiếng), có nút **Gửi báo cáo**
- **Chị 🍓** (tab phải): đánh dấu ngày tới / ngày đi, dự đoán kỳ sau, ngày dễ nóng tính, ngày dễ thụ thai, ngày rụng trứng, lịch tháng và lịch sử
  - Bản tin vui cho cả hai lúc 8h sáng các ngày mốc và khi đánh dấu tới/đi
  - Chỉ là dự đoán để quan tâm nhau, không dùng để tránh thai
- Thông báo đẩy trên iPhone (cần thêm vào MH chính) và Android; cài như app

## Cấu trúc
```
index.html, css/, js/          Giao diện (HTML/CSS/JS thuần, không cần build)
js/config.js                   Địa chỉ Supabase + khoá công khai (publishable)
js/vendor/supabase.js          Thư viện supabase-js đóng gói sẵn
sw.js, manifest.webmanifest    PWA: cài app, offline, nhận thông báo
supabase/schema.sql            Bảng, phân quyền (RLS), kho ảnh, realtime, trigger
supabase/setup.sql             Cấu hình sau khi deploy: URL function, mã mời, cron
supabase/chat.sql              Bản 1.1: bảng tin nhắn, liên kết nhắc giờ ăn ↔ bài báo cáo
supabase/v2.sql                Bản 2.0: giờ ăn chuẩn, tin nhắn ảnh/video, tim trong chat, chu kỳ chị 🍓
supabase/functions/notify/     Edge Function gửi Web Push (WebCrypto, không thư viện ngoài)
```

## Dựng lại từ đầu
1. Tạo project Supabase (gói Free, vùng Singapore), chạy lần lượt `supabase/schema.sql`, `supabase/chat.sql`, `supabase/v2.sql`.
2. Deploy function `supabase/functions/notify` với **verify_jwt = false**.
3. Chạy `supabase/setup.sql` (thay `__REF__`, `__SITE__`, `__INVITE__`).
4. Authentication → Sign In / Providers → Email → tắt **Confirm email**.
5. Điền `SUPABASE_URL` và khoá publishable vào `js/config.js`, đẩy lên GitHub, bật GitHub Pages (nhánh `main`, thư mục gốc).
