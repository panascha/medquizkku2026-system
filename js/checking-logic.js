// js/checking-logic.js

import { auth, db, ref, set, get, onValue, update, remove, onDisconnect, escapeEmail, WEB_APP_URL } from "./firebase-config.js";

// ============================================================================
// STATE MANAGEMENT (จัดการตัวแปรส่วนกลาง)
// ============================================================================
let currentUser = null;
export let allTeams = [];
let teamsData = [];       // เก็บข้อมูลทั้งหมดจาก GAS
let currentFilter = 'all';
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

export async function initCheckingSystem(user) {
    currentUser = user; // กำหนดข้อมูลผู้ใช้งานของเซสชันปัจจุบัน
    setupStaffPresence(user);
    await loadDataFromGAS(); // ดึงข้อมูลทีมทั้งหมดและแสดงตัวโหลดเริ่มต้น
    setupFirebaseListeners();

    // ตัวบอกสถานะการพิมพ์ (Typing indicator) — ทำงานเมื่อแน่ใจว่า DOM โหลดขึ้นมาแล้ว
    const feedbackEl = document.getElementById('feedbackText');
    if (feedbackEl) {
        feedbackEl.addEventListener('input', () => {
            if (currentTeam) {
                update(ref(db, `occupancy/${escapeEmail(currentTeam.id)}`), { isTyping: true, lastActive: Date.now() });
            }
        });
        feedbackEl.addEventListener('blur', () => {
            if (currentTeam) {
                update(ref(db, `occupancy/${escapeEmail(currentTeam.id)}`), { isTyping: false });
            }
        });
    }
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
        await loadAllTeams();
        triggerToast("ดึงข้อมูลสำเร็จ ✅", "success");
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
                    updated: existingTeam ? existingTeam.updated : false,
                    emailSentStatus: row["Additional Form Sent Status"],
                    version: parseInt(row["Review Version"]) || 1,
                    lastModified: new Date(row["Last Review Timestamp"]).getTime(),
                    lastSubmit: row["Last Form Submit Timestamp"] ? new Date(row["Last Form Submit Timestamp"]).getTime() : null,
                    members: [
                        { prefix: row["Member 1 Prefix"], name: row["Member 1 Name"], email: row["Member 1 Email"], phone: row["Member 1 Phone"], school: row["Member 1 School Name"], level: row["Member 1 Level"] },
                        { prefix: row["Member 2 Prefix"], name: row["Member 2 Name"], email: row["Member 2 Email"], phone: row["Member 2 Phone"], school: row["Member 2 School Name"], level: row["Member 2 Level"] },
                        { prefix: row["Member 3 Prefix"], name: row["Member 3 Name"], email: row["Member 3 Email"], phone: row["Member 3 Phone"], school: row["Member 3 School Name"], level: row["Member 3 Level"] }
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
                    additionalFormLink: row["Additional Form Link"],
                    reviewer: row["Reviewer Email"]
                };
            });

            teamsData = allTeams; // Sync both states to point to the exact same array reference

            await syncUpdatedStatusFromFirebase();
            
            if (window.renderStats) window.renderStats(allTeams);
            if (window.filterTeams) window.filterTeams();

            if (callbacks.onTeamsLoaded) callbacks.onTeamsLoaded(allTeams);
        }
    } catch (e) {
        console.error("Load failed", e);
    }
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

                        // ← เพิ่ม 3 บรรทัดนี้
                        t.certUrl = fbData.docs.cert?.url || t.certUrl;
                        t.transcriptUrl = fbData.docs.transcript?.url || t.transcriptUrl;
                        t.slipUrl = fbData.docs.slip?.url || t.slipUrl;
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
                const footer = cardEl.querySelector('.card-footer') || cardEl.querySelector('.team-card-inner');
                if (footer && !footer.querySelector('.occupancy-dot')) {
                    footer.innerHTML += `<span class="occupancy-dot" style="font-size:10px; color:#ea580c; margin-left:8px;"><i class="fa-solid fa-eye fa-pulse"></i> ${occData.staffName} ดูอยู่</span>`;
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

// ============================================================================
// SAVE & CONFLICT LOGIC (เชื่อม GAS)
// ============================================================================

export async function saveReview(payload) {
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
        const response = await fetch(WEB_APP_URL, {
            method: "POST",
            body: JSON.stringify(body)
        });

        // ตรวจสอบและแปลงข้อมูลตอบกลับจาก GAS
        const result = await response.json();
        if (result.status !== "success") {
            throw new Error(result.message || "ระบบหลังบ้าน GAS ปฏิเสธการบันทึกข้อมูล");
        }

        // อัปเดต Firebase Realtime เฉพาะกรณีที่ GAS บันทึกผ่านแล้วเท่านั้น
        const escaped = escapeEmail(currentTeam.id);
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
            allTeams[teamIdx].overall = payload.overallStatus;
            allTeams[teamIdx].certStatus = payload.certStatus;
            allTeams[teamIdx].transcriptStatus = payload.transcriptStatus;
            allTeams[teamIdx].slipStatus = payload.slipStatus;
            allTeams[teamIdx].feedback = payload.feedback;
            allTeams[teamIdx].version = (currentTeam.version || 1) + 1;
            allTeams[teamIdx].updated = false;

            if (payload.sendEmail) {
                allTeams[teamIdx].emailSentStatus = 'ส่งแล้ว';
            }

            currentTeam = { ...allTeams[teamIdx] };
        }

        if (callbacks.onSaveSuccess) callbacks.onSaveSuccess(currentTeam);

    } catch (e) {
        console.error("Save Error:", e);
        if (callbacks.onSaveError) callbacks.onSaveError(e.message);
    }
}

export function computeOverallStatus(cert, trans, slip) {
    const isCertOk  = cert  === "เอกสารเรียบร้อย" || cert  === "ไม่ต้องส่ง";
    const isTransOk = trans === "เอกสารเรียบร้อย" || trans === "ไม่ต้องส่ง";
    const isSlipOk  = slip  === "เอกสารเรียบร้อย"; // สลิปทุกทีมต้องส่ง

    if (isCertOk && isTransOk && isSlipOk) return "การสมัครสมบูรณ์";

    const BAD = ["เอกสารไม่เรียบร้อย", "ยังไม่ได้รับเอกสาร"];
    if (BAD.includes(cert) || BAD.includes(trans) || BAD.includes(slip))
        return "การสมัครไม่เรียบร้อย";

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