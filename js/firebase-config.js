// js/firebase-config.js

// 1. นำเข้า Firebase SDK (ใช้แบบ Modular v9+)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, remove, onDisconnect }
    from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// 2. ตั้งค่า Config
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyC2RSce9kCA9TZ1BgjiAfk2pgE41VnOPY4",
    authDomain: "medquiz-kku-2026.firebaseapp.com",
    databaseURL: "https://medquiz-kku-2026-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "medquiz-kku-2026",
    storageBucket: "medquiz-kku-2026.firebasestorage.app",
    messagingSenderId: "210776025383",
    appId: "1:210776025383:web:c391a04b826fefecf66102",
    measurementId: "G-VJVDG2D7TT"
};

export const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwKSn21RnyxaHv6oCZGytCM2gCwvt_jaAOS_EFw9TJk1IZATD0-90PG8SKTXB6tqT-a_g/exec";

// Web App ของโปรเจกต์ "MedQuiz 2026 Exam Received" (6_DashboardApi.js → doGet)
// ใช้โดย pages/dashboard.html เท่านั้น — deploy แล้ว 2026-07-30
// ถ้า deploy ใหม่ (New deployment) URL จะเปลี่ยน ต้องกลับมาแก้ตรงนี้ด้วย
// ตอน deploy ต้องตั้ง Execute as: Me / Who has access: "Anyone" เท่านั้น
// ถ้าตั้งเป็น "Anyone with a Google account" เบราว์เซอร์จะถูกเด้งไปหน้า login
// ของ Google แล้วติด CORS โหลดข้อมูลไม่ได้เลย — ด่านตรวจสิทธิ์อยู่ใน doGet
// (ต้องแนบ Firebase ID token ของ staff) ไม่ได้อยู่ที่ระดับ deployment
// (ถ้าเว้นว่างไว้ หน้า Dashboard จะใช้ข้อมูลตัวอย่างสำหรับทดสอบ)
export const DASHBOARD_API_URL = "https://script.google.com/macros/s/AKfycbx0NbfUaqMXDl2RKoFcayiFOVjOZUQkUI1NiumKJXVKA_7xjO-4vm-q8Ne2KFLMCi2Q/exec";


// 3. Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

// 4. Utility Function สำหรับจัดการ Email (แปลง . เป็น _)
const escapeEmail = (email) => {
    if (!email || typeof email !== 'string') return "unknown_email";
    return email.trim().toLowerCase().replace(/\./g, '_');
};
// 5. ส่งออกตัวแปรเพื่อให้ไฟล์อื่น (checking-logic.js) เรียกใช้ได้
export { db, auth, ref, set, get, onValue, update, remove, onDisconnect, escapeEmail };