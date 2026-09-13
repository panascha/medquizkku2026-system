// js/staff-guard.js
// Shared gate for every protected page: KKU domain + staff_whitelist/{escapedEmail}.
// No load-time side effects (unlike auth.js), so index.html and the
// dynamic-import paths in dashboard/essay-grading can use it safely.
// This is a UI gate only — data protection must live in RTDB rules / GAS.
import { auth, db, ref, get, escapeEmail } from "./firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const LOGIN_URL = new URL("../pages/login.html", import.meta.url).href;
const STAFF_DOMAINS = ["@kku.ac.th", "@kkumail.com"];

// Set once this page load passed the whitelist; a later re-fire that hits a
// network error must not sign out an open tab mid-edit.
let approved = false;

// Resolves true only for a whitelisted KKU staff account. Anything else (no user,
// wrong domain, not whitelisted, first whitelist read failed) signs out and
// redirects to login — fail closed. Callers must not load data until true.
export async function requireStaff(user) {
    if (!user) { window.location.replace(LOGIN_URL); return false; }

    const email = (user.email || "").trim().toLowerCase();
    let msg = null;
    if (!STAFF_DOMAINS.some(d => email.endsWith(d))) {
        msg = "ไม่อนุญาต! กรุณาใช้ kkumail (@kku.ac.th หรือ @kkumail.com) เท่านั้น";
    } else {
        try {
            const snap = await get(ref(db, `staff_whitelist/${escapeEmail(email)}`));
            if (!snap.exists()) msg = "คุณไม่มีสิทธิ์เข้าถึงระบบ Staff กรุณาติดต่อฝ่าย IT";
        } catch (e) {
            console.error("Whitelist check failed:", e);
            if (approved) return true;
            msg = "ตรวจสอบสิทธิ์ไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่อีกครั้ง";
        }
    }
    if (!msg) { approved = true; return true; }

    alert(msg);
    await signOut(auth).catch(() => {});
    window.location.replace(LOGIN_URL);
    return false;
}
