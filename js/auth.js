// js/auth.js
import { auth, db, ref, get, escapeEmail } from "./firebase-config.js";
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' }); // ให้เลือกบัญชีทุกครั้ง

// ฟังก์ชัน Login: ตรวจสอบโดเมน และ Whitelist (ถ้ามี)
export const loginWithKKU = async () => {
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        // 1. ตรวจสอบ Domain
        const isKKU = user.email.endsWith("@kku.ac.th") || user.email.endsWith("@kkumail.com");

        if (isKKU) {
            // 2. [Optional] ตรวจสอบ Whitelist ใน Firebase (เพิ่มความปลอดภัยอีกชั้น)
            const staffRef = ref(db, `staff_whitelist/${escapeEmail(user.email)}`);
            const snapshot = await get(staffRef);

            if (snapshot.exists()) {
                console.log("Welcome Staff:", user.displayName);
                window.location.href = "checking.html";
                return user;
            } else {
                alert("คุณไม่มีสิทธิ์เข้าถึงระบบ Staff กรุณาติดต่อฝ่าย IT");
                await signOut(auth);
            }
        } else {
            alert("ไม่อนุญาต! กรุณาใช้ kkumail (@kku.ac.th หรือ @kkumail.com) เท่านั้น");
            await signOut(auth);
        }
        return null;
    } catch (error) {
        console.error("Login Error:", error.message);
        throw error;
    }
};

export const logout = () => signOut(auth).then(() => window.location.href = "login.html");

// ตรวจสอบสถานะ Login อัตโนมัติ
onAuthStateChanged(auth, (user) => {
    const isLoginPage = window.location.pathname.includes("login.html");

    if (user) {
        const isValidEmail = user.email.endsWith("@kku.ac.th") || user.email.endsWith("@kkumail.com");
        if (!isValidEmail) {
            signOut(auth);
        } else if (isLoginPage) {
            window.location.href = "checking.html";
        }
    } else {
        if (!isLoginPage) {
            window.location.href = "login.html";
        }
    }
});