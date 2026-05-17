// js/firebase-config.js

// 1. นำเข้า Firebase SDK (ใช้แบบ Modular v9+)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, remove, onDisconnect }
    from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// 2. ตั้งค่า Config
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "medquiz-kku-2026.firebaseapp.com",
    databaseURL: "https://medquiz-kku-2026-default-rtdb.asia-southeast1.firebasedatabase.app/",
    projectId: "medquiz-kku-2026",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

export const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwXG2hRNKpV81ARLVI08bjU8IGO5Fu9wygkkqMfGo_hvPUuQ9zx34-tbTqEnL8R-7r-rQ/exec";


// 3. Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

// 4. Utility Function สำหรับจัดการ Email (แปลง . เป็น _)
const escapeEmail = (email) => email.replace(/\./g, '_');

// 5. ส่งออกตัวแปรเพื่อให้ไฟล์อื่น (checking-logic.js) เรียกใช้ได้
export { db, auth, ref, set, get, onValue, update, remove, onDisconnect, escapeEmail };