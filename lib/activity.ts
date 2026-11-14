// Ported from server.py's action_label()/send() — every successful non-GET request on a
// project gets one row in `activity` with a Persian label derived from the path. Python did
// this centrally in its one send() wrapper; Next.js route handlers don't share one, so each
// mutation route calls logActivity() explicitly at its end instead (same effect).
import { run } from "./db";

const RULES: [RegExp, string][] = [
  [/\/run$/, "اجرای کار"], [/\/kwgap$/, "حذف کلمه از شکاف رقبا"], [/\/publish$/, "انتشار مقاله"],
  [/\/ga$/, "تغییر اتصال Analytics"], [/\/fixbulk$/, "تغییر گروهی اصلاح‌ها"], [/\/apply$/, "ثبت اصلاح‌ها روی سایت"],
  [/\/api\/issues\/\d+\/autofix$/, "رفع خودکار مشکل"], [/\/autofix$/, "رفع خودکار"], [/\/autorun$/, "اعمال خودکار کارها"], [/\/policy$/, "تغییر سطح اختیار"],
  [/\/margin$/, "تغییر سطح سود محصول"], [/\/feed$/, "ساخت فید محصول"], [/\/onboard$/, "تشخیص نوع سایت"],
  [/\/telegram$/, "تغییر یا آزمایش تلگرام"], [/\/plan$/, "تغییر زمان‌بندی محتوا"], [/\/schedule$/, "تغییر زمان‌بندی"],
  [/\/guide$/, "تغییر راهنمای نویسنده"], [/\/api\/fixes\//, "تغییر اصلاح"], [/\/api\/applied\//, "برگرداندن تغییر سایت"],
  [/\/draft$/, "ارسال پیش‌نویس به سایت"], [/\/result$/, "ثبت نتیجه پست"], [/\/image$/, "ساخت عکس محتوا"],
  [/\/api\/content\//, "تغییر محتوا"], [/\/content$/, "افزودن مقاله به صف"], [/\/igplan$/, "ساخت برنامه اینستاگرام"],
  [/\/write$/, "شروع نوشتن با Claude"], [/\/members/, "تغییر اعضا"], [/\/adapter$/, "تغییر اتصال سایت"],
  [/\/tasks$/, "ساخت کار"], [/\/api\/tasks\/\d+\/comments$/, "ثبت نظر"], [/\/api\/tasks\//, "تغییر کار"],
  [/\/compare$/, "مقایسه با رقیب"], [/\/watches/, "تغییر پایش رقیب"], [/\/images/, "تغییر عکس‌ها"],
  [/\/api\/issues\//, "تغییر وضعیت مشکل"], [/\/reports$/, "ساخت گزارش"], [/^\/api\/projects\/[\w-]+$/, "ویرایش پروژه"],
];

export function actionLabel(method: string, path: string): string {
  const rule = RULES.find(([pat]) => pat.test(path));
  return rule ? rule[1] : `${method} ${path}`;
}

export function logActivity(projectId: string, userName: string, method: string, path: string) {
  run("INSERT INTO activity(project_id,user_name,action,ts) VALUES (?,?,?,?)", projectId, userName, actionLabel(method, path), Date.now() / 1000);
}
