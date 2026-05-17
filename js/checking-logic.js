// Checking Logic

import { auth, db, ref, set, get, onValue, update, remove, onDisconnect, escapeEmail, WEB_APP_URL } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ============================================================================
// 1. STATE MANAGEMENT (จัดการตัวแปรส่วนกลาง)
// ============================================================================
let currentUser = null;
let teamsData = [];       // เก็บข้อมูลทั้งหมดจาก GAS
let currentTeam = null;   // ทีมที่กำลังถูกเปิดดู
let currentFilter = 'all';

// ============================================================================
// 2. INITIALIZATION & DATA FETCHING
// ============================================================================

// รอให้ Firebase เช็ค Auth เสร็จก่อนโหลดข้อมูล
onAuthStateChanged(auth, async (user) => {
    if (user && (user.email.endsWith("@kku.ac.th") || user.email.endsWith("@kkumail.com"))) {
        currentUser = user;
        updateStaffPresence("online");
        await loadDataFromGAS();
        setupFirebaseListeners();
    } else {
        window.location.href = "login.html";
    }
});

// ดึงข้อมูล 46 คอลัมน์จาก GAS ครั้งแรกเมื่อเปิดหน้าเว็บ
async function loadDataFromGAS() {
    showToast("กำลังดึงข้อมูลจากฐานข้อมูล...", "loading");
    try {
        const response = await fetch(WEB_APP_URL);
        const result = await response.json();

        if (result.status === "success") {
            teamsData = formatDataForUI(result.data);
            window.renderStats();
            window.filterTeams();
            showToast("ดึงข้อมูลสำเร็จ ✅");
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        console.error("Fetch Error:", error);
        showToast("❌ โหลดข้อมูลล้มเหลว กรุณารีเฟรชหน้าเว็บ");
    }
}

// แปลงข้อมูลจาก GAS ให้เข้ากับโครงสร้างของ UI (แทนที่ Mockup)
function formatDataForUI(gasData) {
    return gasData.map(row => ({
        id: row["Member 1 Email"], // ใช้อีเมลเป็น ID หลัก
        idx: row["rowIdx"],
        teamName: row["Team Name"],
        category: row["Team Category"],
        overall: row["Registration Status Overall"],
        updated: false, // จะถูกเขียนทับโดย Firebase
        emailSentStatus: row["Additional Form Sent Status"],
        version: row["Review Version"] || 1,

        members: [
            { prefix: row["Member 1 Prefix"], name: row["Member 1 Name"], email: row["Member 1 Email"], phone: row["Member 1 Phone"], school: row["Member 1 School Name"], level: row["Member 1 Level"] },
            { prefix: row["Member 2 Prefix"], name: row["Member 2 Name"], email: row["Member 2 Email"], phone: row["Member 2 Phone"], school: row["Member 2 School Name"], level: row["Member 2 Level"] },
            { prefix: row["Member 3 Prefix"], name: row["Member 3 Name"], email: row["Member 3 Email"], phone: row["Member 3 Phone"], school: row["Member 3 School Name"], level: row["Member 3 Level"] }
        ],
        advisor: { name: row["Advisor Name"], phone: row["Advisor Phone"], email: row["Advisor Email"] },
        payment: { date: row["Transfer Date"], time: row["Transfer Time"], bank: row["Transferring Bank"], last4: row["Account Last 4 Digits"] },

        // ลิงก์เอกสาร
        certUrl: row["Latest School Cert"],
        transcriptUrl: row["Latest Transcript (ปพ.7)"],
        slipUrl: row["Latest Payment Slip"],

        // สถานะเอกสาร
        certStatus: row["School Cert Review Status"],
        transcriptStatus: row["Transcript Review Status"],
        slipStatus: row["Payment Slip Review Status"],
        feedback: row["Feedback for Student"],

        // ข้อมูลเบื้องหลัง
        reviewer: row["Reviewer Email"]
    }));
}

// ============================================================================
// 3. FIREBASE REAL-TIME LISTENERS
// ============================================================================

function setupFirebaseListeners() {
    // 3.1 ฟังการเปลี่ยนแปลงสถานะทีม (เพื่ออัปเดตสี Sidebar ทันที)
    const teamsRef = ref(db, 'teams');
    onValue(teamsRef, (snapshot) => {
        const fbTeams = snapshot.val();
        if (!fbTeams) return;

        let needsRender = false;
        teamsData.forEach(t => {
            const fbData = fbTeams[escapeEmail(t.id)];
            if (fbData && fbData.status.reviewVersion > t.version) {
                // ถ้า Firebase มีเวอร์ชันใหม่กว่า ให้เอามาอัปเดตในเครื่อง
                t.overall = fbData.status.overall;
                t.version = fbData.status.reviewVersion;
                t.updated = fbData.status.isUpdated;
                t.certStatus = fbData.docs.cert.status;
                t.transcriptStatus = fbData.docs.transcript.status;
                t.slipStatus = fbData.docs.slip.status;
                t.emailSentStatus = fbData.communication.additionalForm.sentStatus;
                needsRender = true;
            }
        });

        if (needsRender) {
            window.renderStats();
            window.filterTeams();
        }
    });

    // 3.2 ฟังระบบ Occupancy (ไฟบอกสถานะคนตรวจซ้อน)
    const occRef = ref(db, 'occupancy');
    onValue(occRef, (snapshot) => {
        const allOcc = snapshot.val() || {};

        // ล้างป้าย Eye (กำลังดู) ออกจากทุกลิสต์ก่อน
        document.querySelectorAll('.occupancy-dot').forEach(el => el.remove());

        for (const [escapedEmail, occData] of Object.entries(allOcc)) {
            // ไม่ต้องโชว์ชื่อตัวเอง
            if (occData.staffEmail === currentUser.email) continue;

            // แปะป้ายที่ Sidebar
            const cardEl = document.querySelector(`.team-card[data-email="${escapedEmail}"]`);
            if (cardEl) {
                const footer = cardEl.querySelector('.card-footer');
                if (!footer.querySelector('.occupancy-dot')) {
                    footer.innerHTML += `<span class="occupancy-dot"><i class="fa-solid fa-eye fa-pulse"></i> ${occData.staffName} ดูอยู่</span>`;
                }
            }

            // ถ้ากำลังเปิดดูทีมเดียวกัน ให้โชว์แจ้งเตือนในหน้า Detail ด้วย
            if (currentTeam && escapeEmail(currentTeam.id) === escapedEmail) {
                const banner = document.getElementById('staffViewing');
                banner.style.display = 'inline-flex';
                banner.innerHTML = `<i class="fa-solid ${occData.isTyping ? 'fa-pen fa-bounce' : 'fa-eye fa-pulse'}"></i> ${occData.staffName} กำลัง${occData.isTyping ? 'พิมพ์...' : 'ดูทีมนี้อยู่'}`;
            }
        }

        // ปิด Banner ถ้าไม่มีคนดูแล้ว
        if (currentTeam && !allOcc[escapeEmail(currentTeam.id)]) {
            document.getElementById('staffViewing').style.display = 'none';
        }
    });
}

// ============================================================================
// 4. OCCUPANCY & PRESENCE LOGIC
// ============================================================================

async function updateStaffPresence(status) {
    const presenceRef = ref(db, `staff_presence/${escapeEmail(currentUser.email)}`);
    await update(presenceRef, {
        name: currentUser.displayName || "Staff",
        status: status,
        lastOnline: Date.now()
    });
    // ถ้าปิดเว็บให้ลบชื่อออกอัตโนมัติ
    onDisconnect(presenceRef).update({ status: "offline" });
}

async function setTeamOccupancy(teamEmail) {
    const escaped = escapeEmail(teamEmail);
    const occRef = ref(db, `occupancy/${escaped}`);

    await set(occRef, {
        staffEmail: currentUser.email,
        staffName: currentUser.displayName || "Staff",
        action: "viewing",
        isTyping: false,
        lastActive: Date.now()
    });

    // ถ้าปิดแท็บ หรือเน็ตหลุด ให้ปลดล็อกทีมนี้ทันที
    onDisconnect(occRef).remove();
}

async function clearTeamOccupancy(teamEmail) {
    if (!teamEmail) return;
    const occRef = ref(db, `occupancy/${escapeEmail(teamEmail)}`);
    await remove(occRef);
}

// จับเหตุการณ์กำลังพิมพ์ (Typing Indicator)
document.getElementById('feedbackText').addEventListener('input', () => {
    if (currentTeam) {
        update(ref(db, `occupancy/${escapeEmail(currentTeam.id)}`), { isTyping: true, lastActive: Date.now() });
    }
});

document.getElementById('feedbackText').addEventListener('blur', () => {
    if (currentTeam) {
        update(ref(db, `occupancy/${escapeEmail(currentTeam.id)}`), { isTyping: false });
    }
});

// ============================================================================
// 5. SAVE & CONFLICT LOGIC (เชื่อม GAS)
// ============================================================================

window.startSaveFlow = async function (isForce = false) {
    if (!currentTeam) return;

    const btn = document.getElementById('btnSave');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ตรวจสอบข้อมูล...`;

    try {
        const escapedId = escapeEmail(currentTeam.id);

        // 1. PRE-SAVE VERSION CHECK (เช็คใน Firebase ก่อนว่ามีคนแก้ตัดหน้าไหม)
        if (!isForce) {
            const versionSnap = await get(ref(db, `teams/${escapedId}/status/reviewVersion`));
            const fbVersion = versionSnap.val() || 1;

            if (fbVersion > currentTeam.version) {
                // ข้อมูลสวนทาง โชว์ Modal Conflict
                document.getElementById('modalConflict').classList.remove('hidden');
                window.resetSaveBtn();
                return;
            }
        }

        btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up fa-bounce"></i> บันทึกลงระบบ...`;

        // 2. เตรียม Payload ส่งให้ GAS
        const payload = {
            email: currentTeam.id,
            certStatus: document.getElementById('sel-cert').value,
            transcriptStatus: document.getElementById('sel-transcript').value,
            slipStatus: document.getElementById('sel-slip').value,
            feedback: document.getElementById('feedbackText').value,
            overallStatus: calculateOverallStatus(),
            reviewerEmail: currentUser.email,
            sendEmail: document.getElementById('sendEmail').checked,
            currentVersion: currentTeam.version
        };

        // เปลี่ยน Occupancy เป็น Saving เพื่อล็อคคิว
        update(ref(db, `occupancy/${escapedId}`), { action: "saving" });

        // 3. ยิงข้อมูลเข้า GAS API (doPost)
        const response = await fetch(WEB_APP_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        if (result.status === "success") {
            // 4. Update โลคัล & Firebase ให้ซิงค์กัน
            currentTeam.version += 1;
            currentTeam.overall = payload.overallStatus;
            currentTeam.updated = false;

            if (payload.sendEmail) currentTeam.emailSentStatus = 'ส่งแล้ว';

            // เขียนสถานะล่าสุดลง Firebase (เพื่อให้หน้าจอเพื่อนร่วมงานเด้งอัปเดต)
            await updateFirebaseTeamRecord(currentTeam, payload);

            showToast(payload.sendEmail ? "✅ บันทึกและส่งอีเมลสำเร็จ!" : "✅ บันทึกข้อมูลเรียบร้อย");

            // รีเฟรช UI
            window.renderStats();
            window.filterTeams();

        } else {
            throw new Error(result.message);
        }

    } catch (error) {
        console.error("Save Error:", error);
        alert("เกิดข้อผิดพลาดในการบันทึก: " + error.message);
    } finally {
        window.resetSaveBtn();
        if (currentTeam) update(ref(db, `occupancy/${escapeEmail(currentTeam.id)}`), { action: "viewing" });
    }
};

// อัปเดตข้อมูลขึ้น Firebase หลังจากเซฟ GAS ผ่านแล้ว
async function updateFirebaseTeamRecord(team, payload) {
    const teamRef = ref(db, `teams/${escapeEmail(team.id)}`);
    await update(teamRef, {
        "status/overall": payload.overallStatus,
        "status/reviewVersion": team.version,
        "status/isUpdated": false,
        "docs/cert/status": payload.certStatus,
        "docs/transcript/status": payload.transcriptStatus,
        "docs/slip/status": payload.slipStatus,
        "communication/note": payload.feedback,
        "communication/additionalForm/sentStatus": team.emailSentStatus
    });
}

function calculateOverallStatus() {
    const cert = document.getElementById('sel-cert').value;
    const trans = document.getElementById('sel-transcript').value;
    const slip = document.getElementById('sel-slip').value;

    // ถ้าอันไหนบอก "ไม่ต้องส่ง" ถือว่าผ่าน (ใช้กับทีมผสม)
    const isCertOk = cert === "เอกสารเรียบร้อย" || cert === "ไม่ต้องส่ง";
    const isTransOk = trans === "เอกสารเรียบร้อย" || trans === "ไม่ต้องส่ง";
    const isSlipOk = slip === "เอกสารเรียบร้อย" || slip === "ไม่ต้องส่ง";

    if (isCertOk && isTransOk && isSlipOk) return "การสมัครสมบูรณ์";

    if (cert.includes("ไม่") || trans.includes("ไม่") || slip.includes("ไม่") && !cert.includes("ไม่ต้อง")) {
        return "การสมัครไม่เรียบร้อย";
    }

    return "รอการตรวจสอบ";
}

// ============================================================================
// 6. WINDOW BINDINGS (ทำให้เรียกใช้จาก HTML ได้)
// ============================================================================

window.selectTeamData = async function (email, element) {
    if (currentTeam) await clearTeamOccupancy(currentTeam.id); // ลบ occupancy ทีมเก่า

    const team = teamsData.find(t => t.id === email);
    currentTeam = team;

    await setTeamOccupancy(email); // แจ้งเพื่อนว่ากำลังดู
    return team; // ส่งข้อมูลคืนให้ HTML วาดต่อ
};

// เปลี่ยนให้ filter ใช้อ่านจากตัวแปรกลาง teamsData
window.getTeamsData = () => teamsData;

window.forceSave = function () {
    document.getElementById('modalConflict').classList.add('hidden');
    window.startSaveFlow(true); // เซฟทับเวอร์ชันใหม่
};

window.reloadTeamData = async function () {
    document.getElementById('modalConflict').classList.add('hidden');
    await loadDataFromGAS(); // ดึงข้อมูลใหม่
    // โหลดหน้าจอทีมเดิมใหม่
    const t = teamsData.find(x => x.id === currentTeam.id);
    if (t) window.selectTeam(t.id);
};

// จัดการหน้าต่างปิดเบราว์เซอร์
window.addEventListener('beforeunload', () => {
    if (currentTeam) clearTeamOccupancy(currentTeam.id);
    updateStaffPresence("offline");
});