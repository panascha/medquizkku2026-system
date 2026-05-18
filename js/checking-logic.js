// Checking Logic

import { auth, db, ref, set, get, onValue, update, remove, onDisconnect, escapeEmail, WEB_APP_URL } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ============================================================================
// STATE MANAGEMENT (จัดการตัวแปรส่วนกลาง)
// ============================================================================
let currentUser = null;
let teamsData = [];       // เก็บข้อมูลทั้งหมดจาก GAS
let currentFilter = 'all';
export let allTeams = [];
export let currentTeam = null;
export const callbacks = {
    onTeamsLoaded: null,
    onStatusChange: null,
    onOccupancyChange: null,
    onStaffPresenceChange: null,
    onSaveSuccess: null,
    onSaveError: null,
    onConflict: null,
    onToast: null
};

// ============================================================================
// UTILS (ฟังก์ชันช่วยเหลือทั่วไป)
// ===========================================================================

function triggerToast(msg, type) {
    if (callbacks.onToast) callbacks.onToast(msg, type);
}

// ============================================================================
// INITIALIZATION & DATA FETCHING
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

export async function initCheckingSystem(user) {
    setupStaffPresence(user);
    await loadAllTeams();
    setupFirebaseListeners();
}

async function syncUpdatedStatusFromFirebase() {
    const snapshot = await get(ref(db, 'teams'));
    const fbTeams = snapshot.val();
    if (!fbTeams) return;

    teamsData.forEach(t => {
        const fbData = fbTeams[escapeEmail(t.id)];
        if (fbData) {
            t.updated = fbData.status.isUpdated;
        }
    });
}

async function loadDataFromGAS() {
    triggerToast("กำลังดึงข้อมูลจากฐานข้อมูล...", "loading");
    try {
        const response = await fetch(WEB_APP_URL);
        const result = await response.json();

        if (result.status === "success") {
            teamsData = formatDataForUI(result.data);
            allTeams = teamsData; // ซิงค์ข้อมูลเข้า allTeams

            await syncUpdatedStatusFromFirebase();
            
            if (window.renderStats) window.renderStats(teamsData);
            if (window.filterTeams) window.filterTeams();

            if (callbacks.onTeamsLoaded) callbacks.onTeamsLoaded(allTeams);
            triggerToast("ดึงข้อมูลสำเร็จ ✅", "success");
            console.log("Loaded Teams:", allTeams);
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        console.error("Fetch Error:", error);
        triggerToast("❌ โหลดข้อมูลล้มเหลว", "error");
    }
}

export async function loadAllTeams(forceRefresh = false) {
    try {
        const response = await fetch(WEB_APP_URL);
        const result = await response.json();
        if (result.status === "success") {
            allTeams = result.data.map((row, i) => {
                const existingTeam = allTeams.find(t => t.id === row["Member 1 Email"]);
                return {
                idx: i + 1,
                id: row["Member 1 Email"],
                email: row["Member 1 Email"],
                teamName: row["Team Name"],
                category: row["Team Category"],
                overall: row["Registration Status Overall"],
                updated: existingTeam ? existingTeam.updated :  false,
                emailSentStatus: row["Additional Form Sent Status"],
                version: parseInt(row["Review Version"]) || 1,
                lastModified: new Date(row["Last Review Timestamp"]).getTime(),
                members: [
                    { name: row["Member 1 Name"], level: row["Member 1 Level"], school: row["Member 1 School Name"], email: row["Member 1 Email"], phone: row["Member 1 Phone"], prefix: row["Member 1 Prefix"] },
                    { name: row["Member 2 Name"], level: row["Member 2 Level"], school: row["Member 2 School Name"], email: row["Member 2 Email"], phone: row["Member 2 Phone"], prefix: row["Member 2 Prefix"] },
                    { name: row["Member 3 Name"], level: row["Member 3 Level"], school: row["Member 3 School Name"], email: row["Member 3 Email"], phone: row["Member 3 Phone"], prefix: row["Member 3 Prefix"] }
                ],
                advisor: { name: row["Advisor Name"], phone: row["Advisor Phone"], email: row["Advisor Email"] },
                payment: { bank: row["Transferring Bank"], date: row["Transfer Date"], time: row["Transfer Time"], last4: row["Account Last 4 Digits"] },
                certUrl: row["Latest School Cert"],
                transcriptUrl: row["Latest Transcript"],
                slipUrl: row["Latest Payment Slip"],
                certStatus: row["School Cert Review Status"],
                transcriptStatus: row["Transcript Review Status"],
                slipStatus: row["Payment Slip Review Status"],
                feedback: row["Feedback for Student"],
                additionalFormLink: row["Additional Form Link"]
                }
                });
            if (callbacks.onTeamsLoaded) callbacks.onTeamsLoaded(allTeams);
        }
    } catch (e) { console.error("Load failed", e); }
}

// แปลงข้อมูลจาก GAS ให้เข้ากับโครงสร้างของ UI (แทนที่ Mockup)
function formatDataForUI(gasData) {
    return gasData.map((row, i) => {
        const existingTeam = teamsData.find(t => t.id === row["Member 1 Email"]);
        if (!row["Member 1 Email"]) console.warn("Row missing Email:", row);
        return {
            id: row["Member 1 Email"], // ใช้อีเมลเป็น ID หลัก
            idx: i+1,
            teamName: row["Team Name"],
            category: row["Team Category"],
            overall: row["Registration Status Overall"],
            updated: existingTeam ? existingTeam.updated : false,
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
            transcriptUrl: row["Latest Transcript"],
            slipUrl: row["Latest Payment Slip"],

            // สถานะเอกสาร
            certStatus: row["School Cert Review Status"],
            transcriptStatus: row["Transcript Review Status"],
            slipStatus: row["Payment Slip Review Status"],
            feedback: row["Feedback for Student"],

            // ข้อมูลเบื้องหลัง
            reviewer: row["Reviewer Email"]
        };
    });
}

// ============================================================================
// FIREBASE REAL-TIME LISTENERS
// ============================================================================

function setupStaffPresence(user) {
    const pRef = ref(db, `staff_presence/${escapeEmail(user.email)}`);
    set(pRef, {
        name: user.displayName || user.email,
        status: "online",
        lastOnline: Date.now(),
        currentTeam: ""
    });
    onDisconnect(pRef).update({ status: "offline", currentTeam: "" });
}

function setupFirebaseListeners() {
    const teamsRef = ref(db, 'teams');
    onValue(teamsRef, (snapshot) => {
        const fbTeams = snapshot.val();
        if (!fbTeams) return;

        let needsRender = false;

        teamsData.forEach(t => {
            const fbData = fbTeams[escapeEmail(t.id)];
            if (fbData) {
                if (t.updated !== fbData.status.isUpdated) {
                    t.updated = fbData.status.isUpdated;
                    needsRender = true;
                }

                if (fbData.status.reviewVersion > t.version) {
                    t.overall = fbData.status.overall;
                    t.version = fbData.status.reviewVersion;

                    if (fbData.docs) {
                        t.certStatus = fbData.docs.cert?.status || t.certStatus;
                        t.transcriptStatus = fbData.docs.transcript?.status || t.transcriptStatus;
                        t.slipStatus = fbData.docs.slip?.status || t.slipStatus;
                    }

                    if (fbData.communication?.note) t.feedback = fbData.communication.note;
                    if (fbData.communication?.additionalForm) t.emailSentStatus = fbData.communication.additionalForm.sentStatus;

                    needsRender = true;
                }
            }
        });

        if (needsRender) {
            console.log("Firebase Update detected - Rerendering list...");
            if (window.renderStats) window.renderStats(teamsData);
            if (window.filterTeams) window.filterTeams();
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
                const banner = document.getElementById('occupancyBanner');
                const text = document.getElementById('occupancyText'); // ดึง ID text มาด้วย

                if (banner) {
                    banner.style.display = 'inline-flex';
                    if (text) {
                        text.textContent = `${occData.staffName} กำลัง${occData.action === 'editing' ? 'พิมพ์...' : 'ดูอยู่'}`;
                    }
                }
            }
        }

        // ปิด Banner ถ้าไม่มีคนดูแล้ว
        if (currentTeam && !allOcc[escapeEmail(currentTeam.id)]) {
            const banner = document.getElementById('occupancyBanner');
            if (banner) banner.style.display = 'none';
        }
    });
}

// ============================================================================
// OCCUPANCY & PRESENCE LOGIC
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

export async function claimTeam(team) {
    if (currentTeam) await releaseCurrentTeam();
    currentTeam = team;
    const escapedEmail = escapeEmail(team.email);
    const occRef = ref(db, `occupancy/${escapedEmail}`);

    await set(occRef, {
        staffEmail: auth.currentUser.email,
        staffName: auth.currentUser.displayName || "Staff",
        action: "viewing",
        lastActive: Date.now()
    });

    onDisconnect(occRef).remove();
    // อัปเดตสถานะ Presence ว่ากำลังดูทีมไหน
    update(ref(db, `staff_presence/${escapeEmail(auth.currentUser.email)}`), {
        currentTeam: team.teamName
    });
}

export async function releaseCurrentTeam() {
    if (!currentTeam) return;
    await remove(ref(db, `occupancy/${escapeEmail(currentTeam.email)}`));
    currentTeam = null;
}

export function setTypingStatus(isTyping) {
    if (!currentTeam) return;
    update(ref(db, `occupancy/${escapeEmail(currentTeam.email)}`), {
        action: isTyping ? "editing" : "viewing"
    });
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
// SAVE & CONFLICT LOGIC (เชื่อม GAS)
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

            triggerToast(payload.sendEmail ? "✅ บันทึกและส่งอีเมลสำเร็จ!" : "✅ บันทึกข้อมูลเรียบร้อย", "success");

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

export async function saveReview(payload) {
    // เปลี่ยนจาก localCurrentTeam เป็น currentTeam (ซึ่งเป็นตัวแปร Global ในไฟล์นี้)
    if (!currentTeam) {
        console.error("No team selected to save");
        return;
    }

    try {
        const body = {
            ...payload,
            email: currentTeam.id, // ใช้ id ซึ่งเก็บอีเมลหัวหน้าทีมไว้
            reviewerEmail: auth.currentUser.email
        };

        // ส่งไปที่ GAS
        // หมายเหตุ: ไม่ต้องใส่ mode: 'no-cors' เพราะเราต้องการรับผลลัพธ์ success/error
        const response = await fetch(WEB_APP_URL, {
            method: "POST",
            body: JSON.stringify(body)
        });

        // อัปเดต Firebase Realtime
        const escaped = currentTeam.id.replace(/\./g, '_');
        const teamRef = ref(db, `teams/${escaped}`);

        await update(teamRef, {
            "status/overall": payload.overallStatus,
            "status/reviewVersion": (currentTeam.version || 1) + 1,
            "status/isUpdated": false,
            "communication/note": payload.feedback,
            "communication/additionalForm/sentStatus": payload.sendEmail ? "ส่งแล้ว" : (currentTeam.emailSentStatus || "ยังไม่ส่ง")
        });

        // อัปเดตข้อมูลในอาร์เรย์ allTeams เพื่อให้สถิติเปลี่ยนทันที
        const teamIdx = allTeams.findIndex(t => t.id === currentTeam.id);
        if (teamIdx !== -1) {
            // อัปเดตสถานะ overall และข้อมูลอื่นๆ ที่ได้จากการบันทึก
            allTeams[teamIdx].overall = payload.overallStatus; // เช่น "การสมัครไม่เรียบร้อย"
            allTeams[teamIdx].certStatus = payload.certStatus;
            allTeams[teamIdx].transcriptStatus = payload.transcriptStatus;
            allTeams[teamIdx].slipStatus = payload.slipStatus;
            allTeams[teamIdx].feedback = payload.feedback;
            allTeams[teamIdx].version = (currentTeam.version || 1) + 1;
            allTeams[teamIdx].updated = false; // ตรวจแล้ว จุดแดงต้องหาย

            if (payload.sendEmail) {
                allTeams[teamIdx].emailSentStatus = 'ส่งแล้ว';
            }

            // อัปเดตตัวแปรที่กำลังเปิดดูอยู่ด้วย
            currentTeam = { ...allTeams[teamIdx] };
        }

        if (callbacks.onSaveSuccess) callbacks.onSaveSuccess(currentTeam);

    } catch (e) {
        console.error("Save Error:", e);
        if (callbacks.onSaveError) callbacks.onSaveError(e.message);
    }
}

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

export function computeOverallStatus(cert, trans, slip, category) {
    const isCertOk = cert === "เอกสารเรียบร้อย" || cert === "ไม่ต้องส่ง";
    const isTransOk = trans === "เอกสารเรียบร้อย";
    const isSlipOk = slip === "เอกสารเรียบร้อย";
    if (isCertOk && isTransOk && isSlipOk) return "การสมัครสมบูรณ์";
    if (cert.includes("ไม่") || trans.includes("ไม่") || slip.includes("ไม่")) return "การสมัครไม่เรียบร้อย";
    return "รอการตรวจสอบ";
}

// ============================================================================
// WINDOW BINDINGS (ทำให้เรียกใช้จาก HTML ได้)
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