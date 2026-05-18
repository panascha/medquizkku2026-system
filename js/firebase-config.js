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

export const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbw1ChZ4McJTkUzSiAG__fog0i6q-LmgAQwYgHDZKe0j6HRrqoaywJdjJUlGJY_IXdxkBA/exec";


// 3. Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

// 4. Utility Function สำหรับจัดการ Email (แปลง . เป็น _)
const escapeEmail = (email) => {
    if (!email || typeof email !== 'string') return "unknown_email";
    return email.replace(/\./g, '_');
};
// 5. ส่งออกตัวแปรเพื่อให้ไฟล์อื่น (checking-logic.js) เรียกใช้ได้
export { db, auth, ref, set, get, onValue, update, remove, onDisconnect, escapeEmail };